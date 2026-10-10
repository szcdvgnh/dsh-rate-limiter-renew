/**
 * ESM resolve hook: maps the framework specifiers that only exist inside DSH
 * (packed into app.asar) onto the local stubs, so `node --test` can import
 * lib/index.js on a plain Node runtime.
 */
const MAP = {
  "@deepseek-ai/dsh-settings": "./stub-dsh-settings.mjs",
  "@deepseek-ai/schemastery": "./stub-schemastery.mjs"
};

export async function resolve(specifier, context, next) {
  const target = MAP[specifier];
  if (target) return { url: new URL(target, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
