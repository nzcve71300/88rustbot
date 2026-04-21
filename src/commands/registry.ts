import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import { clanCreateCommand } from "./Player Commands/clan-create.js";
import { clanDeleteCommand } from "./Player Commands/clan-delete.js";
import { clanInviteCommand } from "./Player Commands/clan-invite.js";
import { clanKickCommand } from "./Player Commands/clan-kick.js";
import { clanLeaveCommand } from "./Player Commands/clan-leave.js";
import { clanPromoteCommand } from "./Player Commands/clan-promote.js";
import { clanStatsCommand } from "./Player Commands/clan-stats.js";
import { linkCommand } from "./Player Commands/link.js";
import { syncMeCommand } from "./Player Commands/sync-me.js";
import { setupServerCommand } from "./Admin commands/setup-server.js";
import { setupClanCommand } from "./Admin commands/setup-clan.js";
import { testConnectionCommand } from "./Admin commands/test-connection.js";
import { kothSetupCommand } from "./Admin commands/koth-setup.js";
import { kothStartCommand } from "./Admin commands/koth-start.js";
import { managePositionsCommand } from "./Admin commands/manage-positions.js";
import { kothEndCommand } from "./Admin commands/koth-end.js";
import { mazeSetupCommand } from "./Admin commands/maze-setup.js";
import { mazeStartCommand } from "./Admin commands/maze-start.js";
import { mazeDeleteCommand } from "./Admin commands/maze-delete.js";
import { mazeKickCommand } from "./Admin commands/maze-kick.js";
import { nuketownSetupCommand } from "./Admin commands/nuketown-setup.js";
import { nuketownDeleteCommand } from "./Admin commands/nuketown-delete.js";
import { setCommand } from "./Admin commands/set.js";
import { unlinkCommand } from "./Admin commands/unlink.js";
import { kothJoinCommand } from "./Player Commands/koth-join.js";
import { kothLeaveCommand } from "./Player Commands/koth-leave.js";
import { mazeJoinCommand } from "./Player Commands/maze-join.js";
import { mazeLeaveCommand } from "./Player Commands/maze-leave.js";
import { nuketownJoinCommand } from "./Player Commands/nuketown-join.js";
import { nuketownLeaveCommand } from "./Player Commands/nuketown-leave.js";
import { onev1SetupCommand } from "./Admin commands/onev1-setup.js";
import { onev1DeleteCommand } from "./Admin commands/onev1-delete.js";
import { dockedCargoSetupCommand } from "./Admin commands/docked-cargo-setup.js";
import { dockedCargoStartCommand } from "./Admin commands/docked-cargo-start.js";
import { onev1Command } from "./Player Commands/onev1.js";
import { giveTokensCommand } from "./Admin commands/give-tokens.js";

export type SlashCommandModule = {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
};

/** Discord rejects duplicate names in one payload; also guards accidental double registry entries. */
function dedupeSlashCommandsByName(modules: SlashCommandModule[]): SlashCommandModule[] {
  const seen = new Set<string>();
  const out: SlashCommandModule[] = [];
  for (const m of modules) {
    const n = m.data.name;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(m);
  }
  return out;
}

const slashCommandsAll: SlashCommandModule[] = [
  // admin
  setupServerCommand,
  setupClanCommand,
  kothSetupCommand,
  kothStartCommand,
  managePositionsCommand,
  kothEndCommand,
  mazeSetupCommand,
  mazeStartCommand,
  mazeDeleteCommand,
  mazeKickCommand,
  nuketownSetupCommand,
  nuketownDeleteCommand,
  onev1SetupCommand,
  onev1DeleteCommand,
  dockedCargoSetupCommand,
  dockedCargoStartCommand,
  setCommand,
  unlinkCommand,
  giveTokensCommand,

  // player
  clanCreateCommand,
  clanLeaveCommand,
  clanInviteCommand,
  clanPromoteCommand,
  clanKickCommand,
  clanDeleteCommand,
  clanStatsCommand,
  linkCommand,
  syncMeCommand,
  kothJoinCommand,
  kothLeaveCommand,
  mazeJoinCommand,
  mazeLeaveCommand,
  nuketownJoinCommand,
  nuketownLeaveCommand,
  onev1Command,

  // admin/test
  testConnectionCommand,
];

export const slashCommands = dedupeSlashCommandsByName(slashCommandsAll);
