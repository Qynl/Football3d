import * as THREE from 'three';
import type { ArenaDef } from './arenaDefs.ts';
import { createNetTexture, createPitchTexture, createSkyTexture } from './pitchTexture.ts';
import type { PhysicsWorld } from '../physics/world.ts';
import type { WallCollider } from '../physics/colliders.ts';

const CONTAINMENT_TOP = 20;

/**
 * Builds the visual + physical arena. Owns everything it creates so switching
 * arenas is a clean dispose/rebuild.
 */
export class Arena {
  readonly group = new THREE.Group();
  readonly def: ArenaDef;
  private disposables: { dispose(): void }[] = [];
  private crowdMaterials: THREE.ShaderMaterial[] = [];
  private animated: { mesh: THREE.Object3D; baseY: number; speed: number; phase: number }[] = [];
  private time = 0;
  /** Goal mouth centres (z = -halfLength is the "home" goal defended by player 0). */
  readonly goalZ: [number, number];
  readonly netMeshes: THREE.Object3D[] = [];

  constructor(def: ArenaDef) {
    this.def = def;
    this.goalZ = [-def.halfLength, def.halfLength];
    this.build();
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  private build(): void {
    const def = this.def;
    const theme = def.theme;

    // ---- Pitch ----
    const pitchTex = this.track(createPitchTexture(def));
    const pitchGeo = this.track(new THREE.PlaneGeometry(def.halfWidth * 2, def.halfLength * 2));
    const pitchMat = this.track(
      new THREE.MeshStandardMaterial({
        map: pitchTex,
        roughness: theme.surface === 'ice' ? 0.25 : theme.surface === 'neon' ? 0.55 : 0.95,
        metalness: theme.surface === 'ice' ? 0.15 : 0.0,
      }),
    );
    const pitch = new THREE.Mesh(pitchGeo, pitchMat);
    pitch.rotation.x = -Math.PI / 2;
    pitch.receiveShadow = true;
    this.group.add(pitch);

    // Surrounding apron.
    const apronGeo = this.track(
      new THREE.PlaneGeometry(def.halfWidth * 2 + 14, def.halfLength * 2 + 16),
    );
    const apronMat = this.track(
      new THREE.MeshStandardMaterial({
        color: theme.surface === 'sand' ? 0xd9be80 : theme.surface === 'neon' ? 0x0d0a22 : 0x2c6b38,
        roughness: 1,
      }),
    );
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    this.group.add(apron);

    this.buildWalls();
    this.buildGoal(-1);
    this.buildGoal(1);
    this.buildDecor();
  }

  private buildWalls(): void {
    const def = this.def;
    const theme = def.theme;
    const hw = def.halfWidth;
    const hl = def.halfLength;
    const wh = def.wallHeight;
    const t = 0.32;
    const mat = this.track(
      new THREE.MeshStandardMaterial({
        color: theme.wallColor,
        roughness: 0.55,
        metalness: 0.05,
      }),
    );
    const accentMat = this.track(
      new THREE.MeshStandardMaterial({
        color: theme.wallAccent,
        roughness: 0.4,
        emissive: theme.surface === 'neon' ? theme.wallAccent : 0x000000,
        emissiveIntensity: theme.surface === 'neon' ? 0.85 : 0,
      }),
    );

    const addWall = (x: number, z: number, sx: number, sz: number) => {
      const geo = this.track(new THREE.BoxGeometry(sx, wh, sz));
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, wh / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      // Accent cap.
      const capGeo = this.track(new THREE.BoxGeometry(sx * 1.01, 0.09, sz * 1.01));
      const cap = new THREE.Mesh(capGeo, accentMat);
      cap.position.set(x, wh + 0.045, z);
      this.group.add(cap);
    };

    // Side walls.
    addWall(-hw - t / 2, 0, t, hl * 2 + t * 2);
    addWall(hw + t / 2, 0, t, hl * 2 + t * 2);
    // End walls with a gap for the goal mouth.
    const mouth = def.goalWidth / 2 + def.postRadius * 2;
    const segLen = hw - mouth;
    for (const sz of [-1, 1]) {
      if (segLen > 0.1) {
        addWall(-(mouth + segLen / 2), sz * (hl + t / 2), segLen, t);
        addWall(mouth + segLen / 2, sz * (hl + t / 2), segLen, t);
      }
    }
  }

  private buildGoal(side: number): void {
    const def = this.def;
    const z = side * def.halfLength;
    const halfGoal = def.goalWidth / 2;
    const r = def.postRadius;
    const postH = def.goalHeight + r;
    const frameMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.35,
        metalness: 0.15,
        emissive: def.theme.surface === 'neon' ? 0x66ccff : 0x000000,
        emissiveIntensity: def.theme.surface === 'neon' ? 0.4 : 0,
      }),
    );
    const postGeo = this.track(new THREE.CylinderGeometry(r, r, postH, 12));
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, frameMat);
      post.position.set(sx * (halfGoal + r), postH / 2, z);
      post.castShadow = true;
      this.group.add(post);
    }
    const barGeo = this.track(
      new THREE.CylinderGeometry(r, r, def.goalWidth + r * 2 + r * 2, 12),
    );
    const bar = new THREE.Mesh(barGeo, frameMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, def.goalHeight + r, z);
    bar.castShadow = true;
    this.group.add(bar);

    // Back frame verticals + net.
    const depth = def.goalDepth;
    const netTex = this.track(createNetTexture());
    const netMat = this.track(
      new THREE.MeshStandardMaterial({
        map: netTex,
        transparent: true,
        alphaTest: 0.25,
        side: THREE.DoubleSide,
        roughness: 1,
        color: 0xf0f6ff,
      }),
    );
    const netGroup = new THREE.Group();
    // Back panel.
    const backTex = netTex.clone();
    backTex.repeat.set(def.goalWidth / 0.55, def.goalHeight / 0.55);
    backTex.needsUpdate = true;
    const backMat = netMat.clone();
    backMat.map = backTex;
    this.track(backMat);
    this.track(backTex);
    const back = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(def.goalWidth + r * 2, def.goalHeight)),
      backMat,
    );
    back.position.set(0, def.goalHeight / 2, z + side * depth);
    back.rotation.y = side > 0 ? Math.PI : 0;
    netGroup.add(back);
    this.netMeshes.push(back);

    // Side panels.
    const sideTex = netTex.clone();
    sideTex.repeat.set(depth / 0.55, def.goalHeight / 0.55);
    sideTex.needsUpdate = true;
    const sideMat = netMat.clone();
    sideMat.map = sideTex;
    this.track(sideMat);
    this.track(sideTex);
    const sideGeo = this.track(new THREE.PlaneGeometry(depth, def.goalHeight));
    for (const sx of [-1, 1]) {
      const panel = new THREE.Mesh(sideGeo, sideMat);
      panel.position.set(sx * (halfGoal + r), def.goalHeight / 2, z + (side * depth) / 2);
      panel.rotation.y = Math.PI / 2;
      netGroup.add(panel);
    }
    // Roof panel.
    const roofTex = netTex.clone();
    roofTex.repeat.set(def.goalWidth / 0.55, depth / 0.55);
    roofTex.needsUpdate = true;
    const roofMat = netMat.clone();
    roofMat.map = roofTex;
    this.track(roofMat);
    this.track(roofTex);
    const roof = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(def.goalWidth + r * 2, depth)),
      roofMat,
    );
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, def.goalHeight + r * 0.5, z + (side * depth) / 2);
    netGroup.add(roof);
    this.group.add(netGroup);
  }

  private buildDecor(): void {
    const def = this.def;
    const theme = def.theme;
    switch (theme.decor) {
      case 'stadium':
      case 'tiny':
        this.buildStands();
        this.buildFloodlights();
        break;
      case 'rooftop':
        this.buildCity();
        this.buildStands(0.55);
        break;
      case 'beach':
        this.buildBeach();
        break;
      case 'neon':
        this.buildNeon();
        this.buildStands(0.8);
        break;
      case 'ice':
        this.buildStands(0.7);
        this.buildIce();
        break;
    }
  }

  /** Instanced, GPU-animated crowd. Cheap and lively. */
  private buildStands(scale = 1): void {
    const def = this.def;
    const theme = def.theme;
    const hw = def.halfWidth + 2.6;
    const hl = def.halfLength + 2.6;

    // Stand structure.
    const standMat = this.track(
      new THREE.MeshStandardMaterial({ color: theme.wallColor, roughness: 0.9 }),
    );
    const rows = 4;
    for (let row = 0; row < rows; row++) {
      const y = 0.35 + row * 0.45 * scale;
      const ex = hw + row * 0.9;
      const ez = hl + row * 0.9;
      const geoX = this.track(new THREE.BoxGeometry(0.95, 0.4, ez * 2));
      const geoZ = this.track(new THREE.BoxGeometry(ex * 2 + 1.9, 0.4, 0.95));
      for (const s of [-1, 1]) {
        const mx = new THREE.Mesh(geoX, standMat);
        mx.position.set(s * (ex + 0.45), y, 0);
        mx.receiveShadow = true;
        this.group.add(mx);
        const mz = new THREE.Mesh(geoZ, standMat);
        mz.position.set(0, y, s * (ez + 0.45));
        mz.receiveShadow = true;
        this.group.add(mz);
      }
    }

    // Crowd: instanced capsules with a vertex-shader bounce.
    const positions: THREE.Vector3[] = [];
    for (let row = 0; row < rows; row++) {
      const y = 0.55 + row * 0.45 * scale;
      const ex = hw + row * 0.9 + 0.45;
      const ez = hl + row * 0.9 + 0.45;
      const stepZ = 0.85;
      for (let z = -ez; z <= ez; z += stepZ) {
        positions.push(new THREE.Vector3(-ex, y, z));
        positions.push(new THREE.Vector3(ex, y, z));
      }
      const stepX = 0.85;
      for (let x = -ex; x <= ex; x += stepX) {
        positions.push(new THREE.Vector3(x, y, -ez));
        positions.push(new THREE.Vector3(x, y, ez));
      }
    }
    const geo = this.track(new THREE.CapsuleGeometry(0.17, 0.3, 3, 6));
    const mat = this.track(
      new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: false }),
    );
    const phases = new Float32Array(positions.length);
    const colors = new Float32Array(positions.length * 3);
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      dummy.position.copy(p);
      dummy.rotation.y = Math.atan2(-p.x, -p.z);
      dummy.scale.setScalar(0.85 + Math.random() * 0.35);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      phases[i] = Math.random() * Math.PI * 2;
      c.setHex(theme.crowdColors[i % theme.crowdColors.length]);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uHype = { value: 0 };
      shader.vertexShader =
        'attribute float aPhase;\nuniform float uTime;\nuniform float uHype;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float bounce = max(0.0, sin(uTime * 3.1 + aPhase)) * (0.06 + uHype * 0.45);
           transformed.y += bounce;`,
        );
      (mat as unknown as { userData: { shader?: THREE.WebGLProgramParametersWithUniforms } }).userData.shader =
        shader;
      this.crowdMaterials.push(shader as unknown as THREE.ShaderMaterial);
    };
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private buildFloodlights(): void {
    const def = this.def;
    const poleMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xdfe6f0, roughness: 0.6, metalness: 0.3 }),
    );
    const lampMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xfffbe6,
        emissive: 0xfff2b0,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      }),
    );
    const poleGeo = this.track(new THREE.CylinderGeometry(0.14, 0.2, 9, 8));
    const headGeo = this.track(new THREE.BoxGeometry(2.4, 0.8, 0.35));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (def.halfWidth + 6.2);
        const z = sz * (def.halfLength + 6.2);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(x, 4.5, z);
        pole.castShadow = true;
        this.group.add(pole);
        const head = new THREE.Mesh(headGeo, lampMat);
        head.position.set(x, 9.2, z);
        head.lookAt(0, 0, 0);
        this.group.add(head);
      }
    }
  }

  private buildCity(): void {
    const geo = this.track(new THREE.BoxGeometry(1, 1, 1));
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.9 }));
    const count = 90;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    const c = new THREE.Color();
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.2;
      const dist = 26 + Math.random() * 46;
      const hgt = 8 + Math.random() * 34;
      dummy.position.set(Math.cos(angle) * dist, -hgt / 2 - 1.5, Math.sin(angle) * dist);
      dummy.scale.set(4 + Math.random() * 7, hgt, 4 + Math.random() * 7);
      dummy.rotation.y = Math.random() * 0.8;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      c.setHSL(0.6 + Math.random() * 0.08, 0.18, 0.28 + Math.random() * 0.2);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private buildBeach(): void {
    const def = this.def;
    // Sea.
    const seaGeo = this.track(new THREE.PlaneGeometry(400, 400));
    const seaMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0x2ba3d4, roughness: 0.25, metalness: 0.25 }),
    );
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.5, -def.halfLength - 120);
    this.group.add(sea);

    const trunkGeo = this.track(new THREE.CylinderGeometry(0.16, 0.26, 3.6, 7));
    const trunkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 1 }));
    const leafGeo = this.track(new THREE.ConeGeometry(1.5, 0.7, 5));
    const leafMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3fa85f, roughness: 1 }));
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + 0.4;
      const dist = def.halfLength + 6 + Math.random() * 6;
      const x = Math.cos(angle) * dist * 0.75;
      const z = Math.sin(angle) * dist;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, 1.8, z);
      trunk.rotation.z = (Math.random() - 0.5) * 0.3;
      trunk.castShadow = true;
      this.group.add(trunk);
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.set(x, 3.7, z);
      leaves.castShadow = true;
      this.group.add(leaves);
      this.animated.push({ mesh: leaves, baseY: 3.7, speed: 1 + Math.random(), phase: Math.random() * 6 });
    }
  }

  private buildNeon(): void {
    const def = this.def;
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({ color: def.theme.wallAccent, toneMapped: false }),
    );
    for (let i = 0; i < 5; i++) {
      const geo = this.track(
        new THREE.TorusGeometry(def.halfLength + 4 + i * 3.5, 0.09, 6, 64),
      );
      const ring = new THREE.Mesh(geo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02 + i * 0.01;
      this.group.add(ring);
    }
    const pillarGeo = this.track(new THREE.BoxGeometry(0.4, 8, 0.4));
    const pillarMat = this.track(
      new THREE.MeshBasicMaterial({ color: 0x3df5ff, toneMapped: false }),
    );
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(
        Math.cos(a) * (def.halfWidth + 9),
        4,
        Math.sin(a) * (def.halfLength + 9),
      );
      this.group.add(p);
      this.animated.push({ mesh: p, baseY: 4, speed: 1.6 + (i % 4) * 0.3, phase: i });
    }
  }

  private buildIce(): void {
    const def = this.def;
    const moundGeo = this.track(new THREE.SphereGeometry(1, 10, 8));
    const moundMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const m = new THREE.Mesh(moundGeo, moundMat);
      const d = def.halfLength + 7 + Math.random() * 8;
      m.position.set(Math.cos(a) * d * 0.8, 0.1, Math.sin(a) * d);
      m.scale.set(1.4 + Math.random(), 0.5 + Math.random() * 0.4, 1.4 + Math.random());
      m.receiveShadow = true;
      this.group.add(m);
    }
    const treeGeo = this.track(new THREE.ConeGeometry(1.1, 3.4, 7));
    const treeMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2f6b4f, roughness: 1 }));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3;
      const t = new THREE.Mesh(treeGeo, treeMat);
      const d = def.halfLength + 11 + Math.random() * 9;
      t.position.set(Math.cos(a) * d * 0.85, 1.7, Math.sin(a) * d);
      t.castShadow = true;
      this.group.add(t);
    }
  }

  /** Register colliders with the physics world. */
  applyPhysics(world: PhysicsWorld): void {
    const def = this.def;
    world.clear();
    world.ground.y = 0;
    world.ground.friction = def.groundFriction;
    world.ground.restitution = def.groundRestitution;
    world.ground.rollingResistance = def.rollingResistance;
    world.material.gravity = def.gravity;

    const hw = def.halfWidth;
    const hl = def.halfLength;
    const wh = def.wallHeight;
    const mouth = def.goalWidth / 2 + def.postRadius * 2;
    const wallProps = { restitution: def.wallRestitution, friction: 0.35 };

    const push = (w: WallCollider) => world.walls.push(w);

    // Visible low walls (sides).
    for (const s of [-1, 1]) {
      push({
        axis: 'x',
        coord: s * hw,
        normalSign: -s,
        min: -hl - 1,
        max: hl + 1,
        height: wh,
        bottom: 0,
        kind: 'wall',
        ...wallProps,
      });
    }
    // Visible low walls (ends, split by the goal mouth).
    for (const s of [-1, 1]) {
      push({
        axis: 'z',
        coord: s * hl,
        normalSign: -s,
        min: -hw - 1,
        max: -mouth,
        height: wh,
        bottom: 0,
        kind: 'wall',
        ...wallProps,
      });
      push({
        axis: 'z',
        coord: s * hl,
        normalSign: -s,
        min: mouth,
        max: hw + 1,
        height: wh,
        bottom: 0,
        kind: 'wall',
        ...wallProps,
      });
    }

    // Invisible containment above the low walls: lobs stay in play.
    const contain = { restitution: 0.45, friction: 0.25 };
    for (const s of [-1, 1]) {
      push({
        axis: 'x',
        coord: s * (hw + 0.7),
        normalSign: -s,
        min: -hl - 2,
        max: hl + 2,
        height: CONTAINMENT_TOP,
        bottom: wh,
        kind: 'wall',
        ...contain,
      });
      // Behind the goals, above the crossbar.
      push({
        axis: 'z',
        coord: s * (hl + 0.7),
        normalSign: -s,
        min: -mouth,
        max: mouth,
        height: CONTAINMENT_TOP,
        bottom: def.goalHeight + def.postRadius * 2,
        kind: 'wall',
        ...contain,
      });
      push({
        axis: 'z',
        coord: s * (hl + 0.7),
        normalSign: -s,
        min: -hw - 2,
        max: -mouth,
        height: CONTAINMENT_TOP,
        bottom: wh,
        kind: 'wall',
        ...contain,
      });
      push({
        axis: 'z',
        coord: s * (hl + 0.7),
        normalSign: -s,
        min: mouth,
        max: hw + 2,
        height: CONTAINMENT_TOP,
        bottom: wh,
        kind: 'wall',
        ...contain,
      });
    }

    // Goal structures.
    const halfGoal = def.goalWidth / 2;
    for (const s of [-1, 1]) {
      const z = s * hl;
      for (const sx of [-1, 1]) {
        world.posts.push({
          x: sx * (halfGoal + def.postRadius),
          z,
          radius: def.postRadius,
          yMin: 0,
          yMax: def.goalHeight + def.postRadius,
          restitution: 0.72,
          kind: 'post',
        });
      }
      world.bars.push({
        axis: 'x',
        min: -(halfGoal + def.postRadius),
        max: halfGoal + def.postRadius,
        other: z,
        y: def.goalHeight + def.postRadius,
        radius: def.postRadius,
        restitution: 0.68,
        kind: 'crossbar',
      });
      // Nets (inside the goal).
      const zBack = z + s * def.goalDepth;
      push({
        axis: 'z',
        coord: zBack,
        normalSign: -s,
        min: -halfGoal - 0.2,
        max: halfGoal + 0.2,
        height: def.goalHeight,
        bottom: 0,
        kind: 'goalback',
        restitution: 0.12,
        friction: 0.8,
        damping: 0.55,
      });
      for (const sx of [-1, 1]) {
        push({
          axis: 'x',
          coord: sx * (halfGoal + def.postRadius),
          normalSign: -sx,
          min: Math.min(z, zBack),
          max: Math.max(z, zBack),
          height: def.goalHeight,
          bottom: 0,
          kind: 'net',
          restitution: 0.15,
          friction: 0.8,
          damping: 0.5,
        });
      }
    }
  }

  applyLighting(scene: THREE.Scene, sun: THREE.DirectionalLight, ambient: THREE.HemisphereLight): void {
    const theme = this.def.theme;
    const sky = createSkyTexture(theme.sky, theme.skyBottom);
    this.track(sky);
    scene.background = sky;
    scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
    sun.color.setHex(theme.sunColor);
    sun.intensity = theme.sunIntensity;
    ambient.intensity = theme.ambientIntensity;
    ambient.color.setHex(theme.ambient);
    ambient.groundColor.setHex(theme.grassA);
  }

  /** Player containment bounds (feet position). */
  clampPlayer(pos: { x: number; y: number; z: number }, radius: number): void {
    const def = this.def;
    const hw = def.halfWidth - radius;
    const hl = def.halfLength - radius;
    pos.x = Math.max(-hw, Math.min(hw, pos.x));
    const inMouth = Math.abs(pos.x) < def.goalWidth / 2 - radius * 0.5;
    const limit = inMouth ? def.halfLength + def.goalDepth - radius : hl;
    pos.z = Math.max(-limit, Math.min(limit, pos.z));
  }

  update(dt: number, hype: number): void {
    this.time += dt;
    for (const shader of this.crowdMaterials) {
      const u = (shader as unknown as { uniforms: Record<string, { value: number }> }).uniforms;
      if (u.uTime) u.uTime.value = this.time;
      if (u.uHype) u.uHype.value += (hype - u.uHype.value) * Math.min(1, dt * 4);
    }
    for (const a of this.animated) {
      a.mesh.position.y = a.baseY + Math.sin(this.time * a.speed + a.phase) * 0.12;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose?.();
    });
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.crowdMaterials.length = 0;
    this.animated.length = 0;
    this.group.clear();
  }
}
