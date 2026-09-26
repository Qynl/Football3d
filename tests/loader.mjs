/**
 * Node loader hook for the test suite.
 *
 * Node can strip plain TypeScript types on its own, but it cannot compile JSX,
 * and the UI is React. This runs every project .ts/.tsx file through the
 * TypeScript compiler that is already a dependency, so `node tests/run.ts`
 * executes exactly the same sources Vite bundles.
 */
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PROJECT = /\.tsx?$/;

registerHooks({
  load(url, context, nextLoad) {
    // The entry point imports a stylesheet; Vite handles that, Node does not.
    if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default {};' };
    if (!PROJECT.test(url) || url.includes('/node_modules/')) return nextLoad(url, context);
    const filename = fileURLToPath(url);
    const source = readFileSync(filename, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
        verbatimModuleSyntax: false,
        useDefineForClassFields: true,
      },
    });
    return { format: 'module', shortCircuit: true, source: outputText };
  },
});
