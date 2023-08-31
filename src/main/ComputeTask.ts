export interface ComputeTask {
    moduleUrl: string;
    params: any;
    timeout: number;
}

export interface ComputeResult {
    result?: any;
    error?: any;
    profile?: any;
}
