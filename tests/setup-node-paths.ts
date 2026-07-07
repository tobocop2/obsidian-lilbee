import { posix } from "path";
import { node } from "../src/binary-manager";

// Present a unix-like platform to the unit suite so platform-branch tests run
// the same on macOS and Windows runners as on the Ubuntu reference. Tests that
// exercise a specific platform (win32 / darwin) override process.platform
// locally. This is only wired into the unit config, not the integration one,
// which must see the real platform to download the right server binary.
Object.defineProperty(process, "platform", { value: "linux", configurable: true });

// Make path joins deterministic across host OSes so the suite asserts one path
// shape (POSIX) regardless of the runner. Runs after tests/setup.ts so `window`
// is defined before binary-manager loads. The shipped plugin uses each
// platform's native separators; only the test environment is normalized here.
node.join = posix.join;
node.dirname = posix.dirname;
node.basename = posix.basename;
node.resolve = posix.resolve;
