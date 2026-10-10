/**
 * Minimal stand-in for `@deepseek-ai/schemastery`.
 *
 * The real library is shipped inside DeepSeek Harness (packed into app.asar), so
 * a plain `node --test` run cannot resolve it. The harness only needs the
 * declarative surface lib/index.js uses (`z.object/string/number/boolean/array`,
 * `.default()`, `.volatile()`) plus `.volatile()` being a real method, which
 * `assertSchemasterySupportsVolatile()` probes at load time.
 *
 * `meta` is kept public on purpose: test/host.test.mjs asserts that every
 * editable Config field is declared `.volatile()`, which is what makes the field
 * live-editable on DSH 0.2.x.
 */
class Schema {
  constructor(kind, meta) {
    this.kind = kind;
    this.meta = { ...meta };
  }

  withMeta(patch) {
    return new Schema(this.kind, { ...this.meta, ...patch });
  }

  default(value) {
    return this.withMeta({ default: value });
  }

  volatile() {
    return this.withMeta({ volatile: true });
  }

  description(text) {
    return this.withMeta({ description: text });
  }

  role(role) {
    return this.withMeta({ role });
  }

  required() {
    return this.withMeta({ required: true });
  }
}

const z = {
  string: () => new Schema("string", {}),
  number: () => new Schema("number", {}),
  boolean: () => new Schema("boolean", {}),
  array: (inner) => new Schema("array", { inner }),
  object: (shape) => new Schema("object", { shape }),
  Schema
};

export default z;
export { Schema };
