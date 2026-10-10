/**
 * Registers the resolve hook. Passed to Node as
 *   --import ./test/harness/register.mjs
 * before the test files are loaded.
 */
import { register } from "node:module";

register(new URL("./hooks.mjs", import.meta.url));
