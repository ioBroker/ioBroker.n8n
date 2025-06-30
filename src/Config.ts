// This class just simulates the Config class from oclif/core.
export class Config {
    options: any = {};
    arch: any = process.arch;
    bin: string = '';
    channel: string = '';
    dirname: string = '';
    home: string = '';
    name: string = '';
    root: string = '';
    shell: string = '';
    valid: boolean = true;
    version: string = '';
    windows: boolean = process.platform === 'win32';
    constructor(options: any) {
        this.options = options;
    }
    static load(opts?: any): Promise<Config> {
        return Promise.resolve(new Config(opts));
    }
    get commands(): any[] {
        return [];
    }
    get topics(): any[] {
        return [];
    }
    load(): Promise<void> {
        return Promise.resolve();
    }
    runHook<T extends keyof any>(
        event: T,
        _opts: any[T]['options'],
        _timeout?: number,
        _captureErrors?: boolean,
    ): Promise<any> {
        if (event === 'preparse') {
            // Simulate initialization logic
            return Promise.resolve({
                failures: [],
                successes: [],
            });
        }
        return Promise.resolve();
    }
}
