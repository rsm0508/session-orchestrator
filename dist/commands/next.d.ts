import { Command } from '@oclif/core';
export default class Next extends Command {
    static description: string;
    static examples: string[];
    static flags: {
        repo: import("@oclif/core/interfaces").OptionFlag<string | undefined, import("@oclif/core/interfaces").CustomOptions>;
        'dry-run': import("@oclif/core/interfaces").BooleanFlag<boolean>;
        json: import("@oclif/core/interfaces").BooleanFlag<boolean>;
    };
    run(): Promise<void>;
}
//# sourceMappingURL=next.d.ts.map