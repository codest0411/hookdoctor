declare namespace NodeJS {
  type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | string;
  type ProcessEnv = Record<string, string | undefined>;
}

declare const process: {
  argv: string[];
  execPath: string;
  cwd(): string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exitCode?: number;
  stdout: { write(s: string): boolean; isTTY?: boolean };
  stderr: { write(s: string): boolean; isTTY?: boolean };
};

declare const Buffer: {
  alloc(size: number): Uint8Array & {
    subarray(start?: number, end?: number): { toString(encoding?: string): string };
  };
  from(data: string, encoding?: string): Uint8Array;
};

declare module "node:fs" {
  export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mode: number;
    size: number;
  }
  export interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }
  export function existsSync(p: string | URL): boolean;
  export function statSync(p: string | URL): Stats;
  export function lstatSync(p: string | URL): Stats;
  export function realpathSync(p: string | URL): string;
  export function readdirSync(p: string | URL, opts: { withFileTypes: true }): Dirent[];
  export function readdirSync(p: string | URL): string[];
  export function readFileSync(p: string | URL, encoding: "utf8"): string;
  export function writeFileSync(p: string | URL, data: string, encoding?: "utf8"): void;
  export function mkdirSync(p: string | URL, opts?: { recursive?: boolean }): void;
  export function rmSync(p: string | URL, opts?: { recursive?: boolean; force?: boolean }): void;
  export function chmodSync(p: string | URL, mode: number): void;
  export function symlinkSync(target: string, path: string): void;
  export function mkdtempSync(prefix: string): string;
  export function openSync(p: string | URL, flags: string): number;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null
  ): number;
  export function closeSync(fd: number): void;
}

declare module "node:path" {
  export const sep: string;
  export const delimiter: string;
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function extname(p: string): string;
  export function dirname(p: string): string;
  export function basename(p: string): string;
}

declare module "node:os" {
  export function homedir(): string;
  export function tmpdir(): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:child_process" {
  interface ExecFileFunction {
    (
      file: string,
      args: string[],
      options: Record<string, unknown>,
      callback: (err: Error | null, stdout: string, stderr: string) => void
    ): unknown;
    __promisify__(
      file: string,
      args: string[],
      options: Record<string, unknown>
    ): Promise<{ stdout: string; stderr: string }>;
  }
  export const execFile: ExecFileFunction;
  export function execFileSync(
    file: string,
    args: string[],
    options?: Record<string, unknown>
  ): string;
}

declare module "node:util" {
  export function promisify<T extends { __promisify__: (...args: never[]) => unknown }>(
    fn: T
  ): T["__promisify__"];
  export function parseArgs(config: {
    args?: string[];
    allowPositionals?: boolean;
    options?: Record<string, { type: "string" | "boolean"; short?: string; default?: string | boolean }>;
  }): {
    values: Record<string, string | boolean | undefined>;
    positionals: string[];
  };
}

declare module "node:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    match(value: string, regexp: RegExp, message?: string): void;
    doesNotMatch(value: string, regexp: RegExp, message?: string): void;
    rejects(
      block: Promise<unknown> | (() => Promise<unknown>),
      error?: ((err: unknown) => boolean) | unknown,
      message?: string
    ): Promise<void>;
    throws(block: () => unknown, error?: unknown, message?: string): void;
    doesNotThrow(block: () => unknown, message?: string): void;
  };
  export default assert;
}
