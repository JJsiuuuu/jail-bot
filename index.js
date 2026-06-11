require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// Register slash commands
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('jail')
      .setDescription('Removes all roles from a user and adds the Jailed role')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to jail')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON(),

    new SlashCommandBuilder()
      .setName('unjail')
      .setDescription('Restores a jailed user\'s roles')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The user to unjail')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered globally.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
}

// In-memory store for jailed users' original roles
// Format: { guildId: { userId: [roleId, roleId, ...] } }
const jailStore = {};

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;

  if (commandName === 'jail') {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getMember('user');

    if (!targetUser) {
      return interaction.editReply('❌ Could not find that user in this server.');
    }

    if (targetUser.id === interaction.user.id) {
      return interaction.editReply('❌ You cannot jail yourself.');
    }

    if (targetUser.id === guild.ownerId) {
      return interaction.editReply('❌ You cannot jail the server owner.');
    }

    // Check bot's highest role vs target's highest role
    const botMember = guild.members.me;
    if (targetUser.roles.highest.position >= botMember.roles.highest.position) {
      return interaction.editReply('❌ I cannot manage this user — their highest role is equal to or above mine.');
    }

    // Find or create the "Jailed" role
    let jailedRole = guild.roles.cache.find(r => r.name === 'Jailed');
    if (!jailedRole) {
      try {
        jailedRole = await guild.roles.create({
          name: 'Jailed',
          color: '#808080',
          reason: 'Auto-created by jail bot',
        });
        console.log(`Created "Jailed" role in guild ${guild.id}`);
      } catch (err) {
        console.error('Failed to create Jailed role:', err);
        return interaction.editReply('❌ Failed to create the "Jailed" role. Make sure I have Manage Roles permission.');
      }
    }

    // Save current roles (excluding @everyone)
    const currentRoles = targetUser.roles.cache
      .filter(r => r.id !== guild.id) // exclude @everyone
      .map(r => r.id);

    if (!jailStore[guild.id]) jailStore[guild.id] = {};
    jailStore[guild.id][targetUser.id] = currentRoles;

    try {
      // Remove all roles and add Jailed
      await targetUser.roles.set([jailedRole.id], `Jailed by ${interaction.user.tag}`);
      await interaction.editReply(`✅ **${targetUser.user.tag}** has been jailed. Their ${currentRoles.length} role(s) have been removed.`);
    } catch (err) {
      console.error('Failed to update roles:', err);
      return interaction.editReply('❌ Failed to update roles. Check my permissions and role hierarchy.');
    }
  }

  if (commandName === 'unjail') {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getMember('user');

    if (!targetUser) {
      return interaction.editReply('❌ Could not find that user in this server.');
    }

    const savedRoles = jailStore[guild.id]?.[targetUser.id];

    if (!savedRoles) {
      return interaction.editReply('❌ No jail record found for this user. Their original roles cannot be restored automatically.');
    }

    const jailedRole = guild.roles.cache.find(r => r.name === 'Jailed');

    // Resolve saved role IDs to actual roles (some might have been deleted)
    const rolesToRestore = savedRoles
      .map(id => guild.roles.cache.get(id))
      .filter(Boolean);

    try {
      await targetUser.roles.set(rolesToRestore, `Unjailed by ${interaction.user.tag}`);
      delete jailStore[guild.id][targetUser.id];
      await interaction.editReply(`✅ **${targetUser.user.tag}** has been unjailed and their ${rolesToRestore.length} role(s) restored.`);
    } catch (err) {
      console.error('Failed to restore roles:', err);
      return interaction.editReply('❌ Failed to restore roles. Check my permissions and role hierarchy.');
    }
  }
});

client.login(TOKEN);