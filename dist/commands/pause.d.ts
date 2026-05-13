import { Command } from '@oclif/core';
export default class Pause extends Command {
    static description: string;
    static examples: string[];
    static flags: {
        repo: import("@oclif/core/interfaces").OptionFlag<string | undefined, import("@oclif/core/interfaces").CustomOptions>;
        reason: import("@oclif/core/interfaces").OptionFlag<string | undefined, import("@oclif/core/interfaces").CustomOptions>;
    };
    run(): Promise<void>;
}
//# sourceMappingURL=pause.d.ts.map