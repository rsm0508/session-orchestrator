import { Command } from '@oclif/core';
export default class Status extends Command {
    static description: string;
    static flags: {
        repo: import("@oclif/core/interfaces").OptionFlag<string | undefined, import("@oclif/core/interfaces").CustomOptions>;
    };
    run(): Promise<void>;
}
//# sourceMappingURL=status.d.ts.map