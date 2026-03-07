export const desktopScreens = [
	{
		id: 'main-window',
		title: 'Main Window',
		group: 'Core workspace',
		sourceUi: 'MainWindow.ui',
		summary: 'Primary voice, channel, and text workspace for connected users.',
		stubActions: ['Join server', 'Browse channels', 'Open in-room chat'],
		surfaces: ['Channel tree', 'Server status', 'Conversation panel', 'Voice controls']
	},
	{
		id: 'connect-dialog',
		title: 'Connect Dialog',
		group: 'Core workspace',
		sourceUi: 'ConnectDialog.ui',
		summary: 'Server browser and quick-connect launcher for bookmarks, LAN, and direct join.',
		stubActions: ['Browse favorites', 'Open LAN tab', 'Connect to endpoint'],
		surfaces: ['Favorites list', 'Recent servers', 'LAN discovery', 'Connection form']
	},
	{
		id: 'connect-dialog-edit',
		title: 'Connect Dialog Edit',
		group: 'Core workspace',
		sourceUi: 'ConnectDialogEdit.ui',
		summary: 'Saved server editor for labels, endpoints, and per-server metadata.',
		stubActions: ['Rename entry', 'Update host', 'Store credentials'],
		surfaces: ['Server identity', 'Address fields', 'Bookmark options', 'Validation state']
	},
	{
		id: 'server-information',
		title: 'Server Information',
		group: 'Core workspace',
		sourceUi: 'ServerInformation.ui',
		summary: 'Read-only server details, certificates, welcome text, and uptime surfaces.',
		stubActions: ['Inspect metadata', 'Review certificate', 'Copy server info'],
		surfaces: ['Identity summary', 'Certificate details', 'Version info', 'Welcome message']
	},
	{
		id: 'search-dialog',
		title: 'Search Dialog',
		group: 'Core workspace',
		sourceUi: 'SearchDialog.ui',
		summary: 'Search channels and users across the active server tree.',
		stubActions: ['Search users', 'Search channels', 'Jump to result'],
		surfaces: ['Search box', 'Filters', 'Results tree', 'Context preview']
	},
	{
		id: 'text-message',
		title: 'Text Message',
		group: 'Core workspace',
		sourceUi: 'TextMessage.ui',
		summary: 'Compose and review direct, channel, and broadcast text messages.',
		stubActions: ['Draft message', 'Attach rich text', 'Send to target'],
		surfaces: ['Composer', 'Audience selector', 'Formatting tools', 'Message history']
	},
	{
		id: 'user-information',
		title: 'User Information',
		group: 'Core workspace',
		sourceUi: 'UserInformation.ui',
		summary: 'Inspect user profile details, certificates, session status, and comments.',
		stubActions: ['Review identity', 'Inspect stats', 'Open moderation tools'],
		surfaces: ['Profile summary', 'Session details', 'Comment thread', 'Trust indicators']
	},
	{
		id: 'user-edit',
		title: 'User Edit',
		group: 'Core workspace',
		sourceUi: 'UserEdit.ui',
		summary: 'Edit registration details and role attributes for server members.',
		stubActions: ['Rename user', 'Adjust notes', 'Persist registration'],
		surfaces: ['Editable profile', 'Role assignment', 'Permission note', 'Save state']
	},
	{
		id: 'user-local-nickname',
		title: 'User Local Nickname',
		group: 'Core workspace',
		sourceUi: 'UserLocalNicknameDialog.ui',
		summary: 'Store local nicknames for friendlier display names inside the client.',
		stubActions: ['Set alias', 'Clear alias', 'Apply local override'],
		surfaces: ['Alias editor', 'Resolved display', 'Conflict notice', 'Reset controls']
	},
	{
		id: 'tokens',
		title: 'Tokens',
		group: 'Core workspace',
		sourceUi: 'Tokens.ui',
		summary: 'Manage access tokens used for protected channels and temporary permissions.',
		stubActions: ['Add token', 'Remove token', 'Copy token bundle'],
		surfaces: ['Token list', 'Manual entry', 'Import/export', 'Usage guidance']
	},
	{
		id: 'developer-console',
		title: 'Developer Console',
		group: 'Core workspace',
		sourceUi: null,
		summary: 'Stub for protocol traces, diagnostics, and internal tooling not backed by a .ui form.',
		stubActions: ['Open traces', 'Inspect events', 'Copy diagnostics'],
		surfaces: ['Console output', 'Structured events', 'Filters', 'Export tools']
	},
	{
		id: 'audio-wizard',
		title: 'Audio Wizard',
		group: 'Audio',
		sourceUi: 'AudioWizard.ui',
		summary: 'Guided first-run flow for device selection, levels, and transmit behavior.',
		stubActions: ['Pick microphone', 'Tune levels', 'Confirm detection'],
		surfaces: ['Wizard steps', 'Level meter', 'Transmit mode', 'Test playback']
	},
	{
		id: 'audio-input',
		title: 'Audio Input',
		group: 'Audio',
		sourceUi: 'AudioInput.ui',
		summary: 'Detailed microphone, VAD, push-to-talk, and noise suppression controls.',
		stubActions: ['Select input device', 'Adjust VAD', 'Toggle noise reduction'],
		surfaces: ['Device picker', 'Input meters', 'Activation tuning', 'Advanced options']
	},
	{
		id: 'audio-output',
		title: 'Audio Output',
		group: 'Audio',
		sourceUi: 'AudioOutput.ui',
		summary: 'Speaker/headset routing, attenuation, and spatial playback configuration.',
		stubActions: ['Select output device', 'Adjust volume', 'Enable attenuation'],
		surfaces: ['Output picker', 'Volume controls', 'Spatialization', 'Delay tuning']
	},
	{
		id: 'audio-stats',
		title: 'Audio Stats',
		group: 'Audio',
		sourceUi: 'AudioStats.ui',
		summary: 'Live transport and codec metrics for monitoring call quality.',
		stubActions: ['Inspect quality', 'Review packet loss', 'Reset counters'],
		surfaces: ['Latency charts', 'Packet counters', 'Codec summary', 'Quality warnings']
	},
	{
		id: 'asio-input',
		title: 'ASIO Input',
		group: 'Audio',
		sourceUi: 'ASIOInput.ui',
		summary: 'Windows-specific ASIO channel mapping and professional interface setup.',
		stubActions: ['Map channels', 'Preview latency', 'Apply ASIO profile'],
		surfaces: ['Driver selector', 'Channel map', 'Latency monitor', 'Session profile']
	},
	{
		id: 'ptt-button-widget',
		title: 'Push-to-Talk Button',
		group: 'Audio',
		sourceUi: 'PTTButtonWidget.ui',
		summary: 'Compact push-to-talk visualizer and interactive trigger stub.',
		stubActions: ['Arm button', 'Test hold', 'Inspect shortcut binding'],
		surfaces: ['State indicator', 'Shortcut summary', 'Input test', 'Accessibility label']
	},
	{
		id: 'positional-audio-viewer',
		title: 'Positional Audio Viewer',
		group: 'Audio',
		sourceUi: 'PositionalAudioViewer.ui',
		summary: 'Preview positional audio coordinates and listener orientation.',
		stubActions: ['Review coordinates', 'Center listener', 'Refresh scene'],
		surfaces: ['Scene preview', 'Coordinate cards', 'Orientation state', 'Plugin status']
	},
	{
		id: 'voice-recorder',
		title: 'Voice Recorder',
		group: 'Audio',
		sourceUi: 'VoiceRecorderDialog.ui',
		summary: 'Stub workflow for recording, reviewing, and exporting captured audio.',
		stubActions: ['Start capture', 'Pause recording', 'Export clip'],
		surfaces: ['Recording state', 'Waveform preview', 'Export settings', 'Storage summary']
	},
	{
		id: 'config-dialog',
		title: 'Configuration',
		group: 'Preferences',
		sourceUi: 'ConfigDialog.ui',
		summary: 'Central preferences shell that aggregates appearance, audio, network, and shortcuts.',
		stubActions: ['Browse sections', 'Inspect defaults', 'Apply settings'],
		surfaces: ['Settings navigation', 'Search preferences', 'Unsaved changes', 'Apply footer']
	},
	{
		id: 'look-config',
		title: 'Look Configuration',
		group: 'Preferences',
		sourceUi: 'LookConfig.ui',
		summary: 'Theme, density, accessibility, and visual presentation settings.',
		stubActions: ['Switch theme', 'Adjust contrast', 'Preview typography'],
		surfaces: ['Theme previews', 'Scale controls', 'Accessibility toggles', 'Preview canvas']
	},
	{
		id: 'network-config',
		title: 'Network Configuration',
		group: 'Preferences',
		sourceUi: 'NetworkConfig.ui',
		summary: 'Transport, reconnect, proxy, and network diagnostics preferences.',
		stubActions: ['Set proxy', 'Tune reconnect', 'Review diagnostics'],
		surfaces: ['Network modes', 'Proxy fields', 'Reconnect policy', 'Diagnostics panel']
	},
	{
		id: 'overlay',
		title: 'Overlay',
		group: 'Preferences',
		sourceUi: 'Overlay.ui',
		summary: 'Game overlay visibility, density, and content controls.',
		stubActions: ['Toggle overlay', 'Move widgets', 'Preview overlay'],
		surfaces: ['Visibility controls', 'Positioning tools', 'Preview frame', 'Game detection']
	},
	{
		id: 'overlay-editor',
		title: 'Overlay Editor',
		group: 'Preferences',
		sourceUi: 'OverlayEditor.ui',
		summary: 'Advanced overlay composition editor for voice, avatar, and channel surfaces.',
		stubActions: ['Rearrange tiles', 'Resize widgets', 'Save preset'],
		surfaces: ['Canvas', 'Widget library', 'Layer inspector', 'Preset actions']
	},
	{
		id: 'lcd',
		title: 'LCD',
		group: 'Preferences',
		sourceUi: 'LCD.ui',
		summary: 'External display output configuration for supported peripherals.',
		stubActions: ['Choose device', 'Toggle output', 'Preview widget set'],
		surfaces: ['Display selector', 'Output toggles', 'Preview panel', 'Compatibility note']
	},
	{
		id: 'log',
		title: 'Log',
		group: 'Preferences',
		sourceUi: 'Log.ui',
		summary: 'Filter event logs and notification preferences.',
		stubActions: ['Filter events', 'Mute notifications', 'Inspect categories'],
		surfaces: ['Event categories', 'Notification matrix', 'Activity preview', 'Reset defaults']
	},
	{
		id: 'cert',
		title: 'Certificates',
		group: 'Preferences',
		sourceUi: 'Cert.ui',
		summary: 'Manage identity certificates, exports, imports, and trust state.',
		stubActions: ['Inspect certificate', 'Import identity', 'Export backup'],
		surfaces: ['Certificate list', 'Fingerprint view', 'Import/export tools', 'Trust warnings']
	},
	{
		id: 'rich-text-editor',
		title: 'Rich Text Editor',
		group: 'Preferences',
		sourceUi: 'RichTextEditor.ui',
		summary: 'Reusable rich text surface for comments, messages, and profile content.',
		stubActions: ['Format content', 'Insert markup', 'Preview output'],
		surfaces: ['Toolbar', 'Editing canvas', 'Markup source', 'Preview']
	},
	{
		id: 'rich-text-editor-link',
		title: 'Rich Text Link Editor',
		group: 'Preferences',
		sourceUi: 'RichTextEditorLink.ui',
		summary: 'Link insertion and validation flow for rich text editing.',
		stubActions: ['Add URL', 'Validate target', 'Apply link'],
		surfaces: ['URL field', 'Display text', 'Validation state', 'Apply actions']
	},
	{
		id: 'global-shortcut',
		title: 'Global Shortcuts',
		group: 'Shortcuts',
		sourceUi: 'GlobalShortcut.ui',
		summary: 'Primary keyboard and device shortcut management for talk and utility actions.',
		stubActions: ['Add shortcut', 'Capture key combo', 'Assign action'],
		surfaces: ['Shortcut table', 'Capture state', 'Action picker', 'Conflict warnings']
	},
	{
		id: 'global-shortcut-buttons',
		title: 'Global Shortcut Buttons',
		group: 'Shortcuts',
		sourceUi: 'GlobalShortcutButtons.ui',
		summary: 'Reusable button row for adding, removing, and testing shortcut definitions.',
		stubActions: ['Append binding', 'Remove binding', 'Test trigger'],
		surfaces: ['Primary actions', 'Secondary actions', 'Test state', 'Inline help']
	},
	{
		id: 'global-shortcut-target',
		title: 'Global Shortcut Target',
		group: 'Shortcuts',
		sourceUi: 'GlobalShortcutTarget.ui',
		summary: 'Target picker for channel, user, and action-specific shortcut routing.',
		stubActions: ['Choose target', 'Scope shortcut', 'Confirm assignment'],
		surfaces: ['Target selector', 'Scope summary', 'Recent targets', 'Confirmation footer']
	},
	{
		id: 'acl-editor',
		title: 'ACL Editor',
		group: 'Administration',
		sourceUi: 'ACLEditor.ui',
		summary: 'Server and channel access control management for groups and inherited rules.',
		stubActions: ['Inspect ACLs', 'Edit group rules', 'Preview inheritance'],
		surfaces: ['Channel tree', 'ACL table', 'Groups panel', 'Inheritance preview']
	},
	{
		id: 'ban-editor',
		title: 'Ban Editor',
		group: 'Administration',
		sourceUi: 'BanEditor.ui',
		summary: 'Server ban list management and review tools.',
		stubActions: ['Review bans', 'Add ban', 'Lift restriction'],
		surfaces: ['Ban table', 'Reason panel', 'Expiration state', 'Moderation tools']
	},
	{
		id: 'ban-dialog',
		title: 'Ban Dialog',
		group: 'Administration',
		sourceUi: 'widgets/BanDialog.ui',
		summary: 'Focused moderation prompt for banning a user from the current server.',
		stubActions: ['Set reason', 'Choose duration', 'Confirm moderation'],
		surfaces: ['Target summary', 'Duration controls', 'Reason form', 'Confirm actions']
	},
	{
		id: 'failed-connection-dialog',
		title: 'Failed Connection Dialog',
		group: 'Administration',
		sourceUi: 'widgets/FailedConnectionDialog.ui',
		summary: 'Error recovery surface for failed server joins and reconnect attempts.',
		stubActions: ['Inspect error', 'Retry connection', 'Open diagnostics'],
		surfaces: ['Error summary', 'Troubleshooting steps', 'Retry actions', 'Diagnostic shortcut']
	},
	{
		id: 'plugin-config',
		title: 'Plugin Configuration',
		group: 'Plugins',
		sourceUi: 'PluginConfig.ui',
		summary: 'Enable, disable, and prioritize runtime plugins and integrations.',
		stubActions: ['Toggle plugin', 'Adjust priority', 'Inspect capabilities'],
		surfaces: ['Plugin list', 'Capability panel', 'Priority controls', 'Health indicators']
	},
	{
		id: 'plugin-installer',
		title: 'Plugin Installer',
		group: 'Plugins',
		sourceUi: 'PluginInstaller.ui',
		summary: 'Install plugin bundles and review source metadata before activation.',
		stubActions: ['Browse package', 'Inspect metadata', 'Install stub bundle'],
		surfaces: ['Package picker', 'Metadata summary', 'Permissions notice', 'Install actions']
	},
	{
		id: 'plugin-updater',
		title: 'Plugin Updater',
		group: 'Plugins',
		sourceUi: 'PluginUpdater.ui',
		summary: 'Review available plugin updates and staged rollout decisions.',
		stubActions: ['Check updates', 'Review changelog', 'Update selected plugins'],
		surfaces: ['Update list', 'Version diff', 'Changelog preview', 'Apply actions']
	},
	{
		id: 'manual-plugin',
		title: 'Manual Plugin',
		group: 'Plugins',
		sourceUi: 'ManualPlugin.ui',
		summary: 'Manual positional audio and plugin fallback configuration.',
		stubActions: ['Set coordinates', 'Toggle manual mode', 'Save profile'],
		surfaces: ['Coordinate editor', 'Manual toggles', 'Profile actions', 'Plugin note']
	}
];

export const appHighlights = [
	{
		title: 'Full Qt form coverage',
		description: 'Every existing desktop .ui form is represented by a navigable web stub.'
	},
	{
		title: 'Hash-based routing',
		description: 'Browser and Electron builds share the same route model without server rewrites.'
	},
	{
		title: 'Electron-ready shell',
		description: 'Packaging scripts and a hardened preload bridge are included for desktop delivery.'
	}
];
