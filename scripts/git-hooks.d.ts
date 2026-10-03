export declare function isTemporaryPath(path: string): boolean
export declare function checkStagedPaths(paths: string[]): void
export declare function isDocumentationPath(path: string): boolean
export declare function checkPush(input: string, remote: string, git: (args: string[]) => string, verify: () => void): boolean
