import { Command } from '@oclif/core';
export default class Run extends Command {
    static description: string;
    static examples: string[];
    static flags: {
        repo: import("@oclif/core/interfaces").OptionFlag<string | undefined, import("@oclif/core/interfaces").CustomOptions>;
        phase: import("@oclif/core/interfaces").OptionFlag<number, import("@oclif/core/interfaces").CustomOptions>;
        'dry-run': import("@oclif/core/interfaces").BooleanFlag<boolean>;
    };
    run(): Promise<void>;
}
//# sourceMappingURL=run.d.ts.map