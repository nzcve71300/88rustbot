import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} from "discord.js";
import { config } from "./config.js";
import { ensureSchema, pool } from "./db/pool.js";
import { getOrCreateGuildRow } from "./db/guilds.js";
import { ensureAdminRole } from "./guild/adminRole.js";
import { slashCommands } from "./commands/registry.js";
import { emoteKitBridge } from "./rcon/emoteKitBridge.js";
import { clanJoinCustomIds, handleJoinClanButton, handleJoinClanModal } from "./clans/joinFlow.js";
import { deleteExpiredInvites } from "./db/clans.js";
import { handleLinkButton, LINK_CANCEL_ID, LINK_CONFIRM_ID } from "./linking/linkFlow.js";
import { handleUnlinkButton, UNLINK_CANCEL_ID, UNLINK_CONFIRM_ID } from "./linking/unlinkFlow.js";
import { startCommandCenterApi } from "./api/commandCenterApi.js";
import { startServerMetricsPoller } from "./metrics/serverMetricsPoller.js";
import {
  handleDockedCargoButton,
  handleDockedCargoChannelSelect,
  handleDockedCargoModal,
  handleDockedCargoRestart,
  handleDockedCargoRoleSelect,
} from "./dockedCargo/interactions.js";
import { handleOneV1Accept, handleOneV1Duck, isOneV1AcceptButton, isOneV1DuckButton } from "./onev1/acceptFlow.js";
import { initDockedCargoScheduler } from "./dockedCargo/runner.js";
import { initKothAutomationScheduler } from "./koth/automation.js";
import { handleKothForceRestart } from "./koth/startInteractions.js";
import { initMazeAutomationScheduler } from "./maze/automation.js";
import { handleMazeForceRestart } from "./maze/startInteractions.js";

async function main() {
  await ensureSchema();
  startServerMetricsPoller(pool);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(config.discordToken);
    const body = slashCommands.map((cmd) => cmd.data.toJSON());
    await rest.put(Routes.applicationCommands(c.user.id), { body });

    for (const [, guild] of c.guilds.cache) {
      try {
        await getOrCreateGuildRow(pool, guild.id);
        await ensureAdminRole(guild);
      } catch (err) {
        console.error(`Failed to bootstrap guild ${guild.id}:`, err);
      }
    }

    try {
      await emoteKitBridge.start(pool);
    } catch (err) {
      console.error("Emote kit bridge failed to start:", err);
    }

    // Optional: website API (used by Netlify to fetch real servers).
    startCommandCenterApi(client);

    initDockedCargoScheduler(pool, client);
    initKothAutomationScheduler(pool, client);
    initMazeAutomationScheduler(pool, client);

    // Keep clan invite table clean (24h expiry).
    setInterval(() => {
      void deleteExpiredInvites(pool).catch((err) => console.error("Invite cleanup failed:", err));
    }, 60 * 60 * 1000);
  });

  client.on(Events.GuildCreate, async (guild) => {
    try {
      await getOrCreateGuildRow(pool, guild.id);
      await ensureAdminRole(guild);
    } catch (err) {
      console.error(`guildCreate bootstrap failed for ${guild.id}:`, err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      const mod = slashCommands.find((x) => x.data.name === interaction.commandName);
      if (mod?.autocomplete) {
        try {
          await mod.autocomplete(interaction);
        } catch (err) {
          console.error(err);
          try {
            await interaction.respond([]);
          } catch {
            /* ignore */
          }
        }
      }
      return;
    }

    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith("dc:rl:")) {
      try {
        await handleDockedCargoRoleSelect(interaction);
      } catch (err) {
        console.error(err);
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
          } else {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (interaction.isChannelSelectMenu() && interaction.customId.startsWith("dc:ch:")) {
      try {
        await handleDockedCargoChannelSelect(interaction);
      } catch (err) {
        console.error(err);
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
          } else {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          }
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("koth:rs:")) {
        try {
          await handleKothForceRestart(interaction);
        } catch (err) {
          console.error(err);
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
            } else {
              await interaction.reply({ content: "Something went wrong.", ephemeral: true });
            }
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (interaction.customId.startsWith("maze:rs:")) {
        try {
          await handleMazeForceRestart(interaction);
        } catch (err) {
          console.error(err);
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
            } else {
              await interaction.reply({ content: "Something went wrong.", ephemeral: true });
            }
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (interaction.customId.startsWith("dc:rs:")) {
        try {
          await handleDockedCargoRestart(interaction);
        } catch (err) {
          console.error(err);
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
            } else {
              await interaction.reply({ content: "Something went wrong.", ephemeral: true });
            }
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (interaction.customId.startsWith("dc:b:")) {
        try {
          await handleDockedCargoButton(interaction);
        } catch (err) {
          console.error(err);
          try {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (isOneV1AcceptButton(interaction.customId)) {
        try {
          await handleOneV1Accept(interaction);
        } catch (err) {
          console.error(err);
          try {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (isOneV1DuckButton(interaction.customId)) {
        try {
          await handleOneV1Duck(interaction);
        } catch (err) {
          console.error(err);
          try {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (interaction.customId === LINK_CONFIRM_ID || interaction.customId === LINK_CANCEL_ID) {
        try {
          await handleLinkButton(interaction);
        } catch (err) {
          console.error(err);
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
          } else {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          }
        }
        return;
      }
      if (interaction.customId === UNLINK_CONFIRM_ID || interaction.customId === UNLINK_CANCEL_ID) {
        try {
          await handleUnlinkButton(interaction);
        } catch (err) {
          console.error(err);
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
          } else {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          }
        }
        return;
      }
      if (interaction.customId === clanJoinCustomIds.button) {
        try {
          await handleJoinClanButton(interaction);
        } catch (err) {
          console.error(err);
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
          } else {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          }
        }
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("dc:m:")) {
        try {
          await handleDockedCargoModal(interaction);
        } catch (err) {
          console.error(err);
          try {
            if (interaction.deferred || interaction.replied) {
              await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
            } else {
              await interaction.reply({ content: "Something went wrong.", ephemeral: true });
            }
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (interaction.customId === clanJoinCustomIds.modal) {
        try {
          await handleJoinClanModal(interaction);
        } catch (err) {
          console.error(err);
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: "Something went wrong.", ephemeral: true });
          } else {
            await interaction.reply({ content: "Something went wrong.", ephemeral: true });
          }
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const mod = slashCommands.find((x) => x.data.name === interaction.commandName);
    if (!mod) return;
    try {
      await mod.execute(interaction);
    } catch (err) {
      console.error(err);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Something went wrong running that command.", ephemeral: true });
      } else {
        await interaction.reply({ content: "Something went wrong running that command.", ephemeral: true });
      }
    }
  });

  await client.login(config.discordToken);
}

void main();
