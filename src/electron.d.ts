declare module "electron" {
    export const shell: { showItemInFolder(fullPath: string): void };
}
