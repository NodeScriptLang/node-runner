export class WorkerError extends Error {
    status = 500;
    override name = this.constructor.name;
}

export class ComputeTimeoutError extends Error {
    status = 408;
    override name = this.constructor.name;
}

export class QueueTimeoutError extends Error {
    status = 429;
    override name = this.constructor.name;
}
