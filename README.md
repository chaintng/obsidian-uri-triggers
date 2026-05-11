# URI Triggers

URI Triggers is an Obsidian plugin that executes configured Obsidian URIs when vault or workspace events happen.

## Supported Events

- File opened
- File closed, inferred when the active file changes away from a previous file
- File created
- File deleted
- File modified
- File renamed

## URI Templates

The settings page shows a compact list of triggers. Use **Add** or **Edit** to open the trigger form popup.

Each trigger stores one or more URI templates (one per line). The plugin replaces these variables before opening each URI:

- `{{event}}`
- `{{path}}`
- `{{previousPath}}`
- `{{basename}}`
- `{{name}}`
- `{{extension}}`

Example:

```text
obsidian://advanced-uri?vault=MyVault&commandid=daily-notes%253Aopen-today
obsidian://advanced-uri?vault=MyVault&commandid=...
```

## Development

```bash
npm install
npm run build
```

Copy `manifest.json` and the generated `main.js` into:

```text
<your-vault>/.obsidian/plugins/uri-triggers/
```

Then enable the plugin in Obsidian.
