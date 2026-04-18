import type { ButtonInteraction } from "discord.js";
import { ONEV1_ACCEPT_PREFIX, ONEV1_DUCK_PREFIX } from "../commands/Player Commands/onev1.js";
import { pool } from "../db/pool.js";
import {
  commitOneV1Accept,
  commitOneV1Duck,
  validateOneV1Accept,
  validateOneV1Duck,
} from "./matchLifecycle.js";

export async function handleOneV1Accept(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: "Invalid context.", ephemeral: true });
    return;
  }

  const raw = interaction.customId.slice(ONEV1_ACCEPT_PREFIX.length);
  const matchId = Number.parseInt(raw, 10);
  if (!Number.isFinite(matchId)) {
    await interaction.reply({ content: "Invalid challenge.", ephemeral: true });
    return;
  }

  const validated = await validateOneV1Accept(pool, matchId, interaction.user.id);
  if (!validated.ok) {
    await interaction.reply({ content: validated.error, ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  try {
    await commitOneV1Accept(interaction.client, pool, validated.data);
  } catch (err) {
    console.error("[1v1] accept commit failed:", err);
    try {
      await interaction.followUp({ content: "Something went wrong processing this challenge.", ephemeral: true });
    } catch {
      /* ignore */
    }
  }
}

export function isOneV1AcceptButton(customId: string): boolean {
  return customId.startsWith(ONEV1_ACCEPT_PREFIX);
}

export async function handleOneV1Duck(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: "Invalid context.", ephemeral: true });
    return;
  }

  const raw = interaction.customId.slice(ONEV1_DUCK_PREFIX.length);
  const matchId = Number.parseInt(raw, 10);
  if (!Number.isFinite(matchId)) {
    await interaction.reply({ content: "Invalid challenge.", ephemeral: true });
    return;
  }

  const validated = await validateOneV1Duck(pool, matchId, interaction.user.id);
  if (!validated.ok) {
    await interaction.reply({ content: validated.error, ephemeral: true });
    return;
  }

  await interaction.deferUpdate();

  try {
    await commitOneV1Duck(interaction.client, pool, validated.match);
  } catch (err) {
    console.error("[1v1] duck commit failed:", err);
    try {
      await interaction.followUp({ content: "Something went wrong processing this challenge.", ephemeral: true });
    } catch {
      /* ignore */
    }
  }
}

export function isOneV1DuckButton(customId: string): boolean {
  return customId.startsWith(ONEV1_DUCK_PREFIX);
}
