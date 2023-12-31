/// <reference types="node" resolution-mode="require"/>
type EnvironmentData = {
    systemPlatform: NodeJS.Platform;
    systemRelease: string;
    systemArchitecture: string;
    cpuCount: number;
    cpuModel: string | null;
    cpuSpeed: number | null;
    memoryInMb: number;
    isCI: boolean;
    ciName: string | null;
    sstVersion: string;
};
export declare function getEnvironmentData(): EnvironmentData;
export {};
