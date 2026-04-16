import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile
} from "obsidian";

const TRIGGER_EVENTS = [
  "file-open",
  "file-close",
  "file-create",
  "file-delete",
  "file-modify",
  "file-rename"
] as const;

type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

interface UriTrigger {
  id: string;
  name: string;
  event: TriggerEvent;
  uriTemplate: string;
  enabled: boolean;
  pathIncludes: string;
}

interface UriTriggerSettings {
  triggers: UriTrigger[];
}

interface TriggerContext {
  event: TriggerEvent;
  file: TFile;
  previousPath: string;
}

const DEFAULT_SETTINGS: UriTriggerSettings = {
  triggers: []
};

const DEFAULT_TRIGGER: Omit<UriTrigger, "id"> = {
  name: "New trigger",
  event: "file-open",
  uriTemplate: "obsidian://",
  enabled: true,
  pathIncludes: ""
};

export default class UriTriggersPlugin extends Plugin {
  settings: UriTriggerSettings = DEFAULT_SETTINGS;
  private activeFilePath = "";

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new UriTriggersSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          this.handleFileOpen(file);
        })
      );

      this.registerEvent(
        this.app.vault.on("create", (file) => {
          this.handleVaultFileEvent("file-create", file);
        })
      );

      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          this.handleVaultFileEvent("file-delete", file);
        })
      );

      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          this.handleVaultFileEvent("file-modify", file);
        })
      );

      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          this.handleVaultRename(file, oldPath);
        })
      );
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData())
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  createTrigger(): UriTrigger {
    const trigger: UriTrigger = {
      ...DEFAULT_TRIGGER,
      id: crypto.randomUUID()
    };

    this.settings.triggers.push(trigger);
    return trigger;
  }

  async removeTrigger(id: string): Promise<void> {
    this.settings.triggers = this.settings.triggers.filter((trigger) => trigger.id !== id);
    await this.saveSettings();
  }

  async updateTrigger(id: string, patch: Partial<Omit<UriTrigger, "id">>): Promise<void> {
    this.settings.triggers = this.settings.triggers.map((trigger) => {
      if (trigger.id !== id) {
        return trigger;
      }

      return {
        ...trigger,
        ...patch
      };
    });

    await this.saveSettings();
  }

  private handleFileOpen(file: TFile | null): void {
    const previousPath = this.activeFilePath;

    if (previousPath && previousPath !== file?.path) {
      const previousFile = this.app.vault.getAbstractFileByPath(previousPath);
      if (previousFile instanceof TFile) {
        this.runMatchingTriggers({
          event: "file-close",
          file: previousFile,
          previousPath
        });
      }
    }

    this.activeFilePath = file?.path ?? "";

    if (file) {
      this.runMatchingTriggers({
        event: "file-open",
        file,
        previousPath
      });
    }
  }

  private handleVaultFileEvent(event: TriggerEvent, file: TAbstractFile): void {
    if (!(file instanceof TFile) || !this.app.workspace.layoutReady) {
      return;
    }

    this.runMatchingTriggers({
      event,
      file,
      previousPath: ""
    });
  }

  private handleVaultRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile) || !this.app.workspace.layoutReady) {
      return;
    }

    if (this.activeFilePath === oldPath) {
      this.activeFilePath = file.path;
    }

    this.runMatchingTriggers({
      event: "file-rename",
      file,
      previousPath: oldPath
    });
  }

  private runMatchingTriggers(context: TriggerContext): void {
    const triggers = this.settings.triggers.filter((trigger) => {
      if (!trigger.enabled || trigger.event !== context.event || !trigger.uriTemplate.trim()) {
        return false;
      }

      return !trigger.pathIncludes || context.file.path.includes(trigger.pathIncludes);
    });

    for (const trigger of triggers) {
      const uri = buildUri(trigger.uriTemplate, context);
      openObsidianUri(uri, trigger.name);
    }
  }
}

class UriTriggersSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: UriTriggersPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "URI Triggers" });
    containerEl.createEl("p", {
      text: "Run Obsidian URIs when files are opened, closed, created, deleted, modified, or renamed."
    });

    new Setting(containerEl)
      .setName("Add trigger")
      .setDesc("Create a new URI trigger.")
      .addButton((button) => {
        button
          .setButtonText("Add")
          .setCta()
          .onClick(async () => {
            this.plugin.createTrigger();
            await this.plugin.saveSettings();
            this.display();
          });
      });

    for (const trigger of this.plugin.settings.triggers) {
      this.renderTrigger(containerEl, trigger);
    }
  }

  private renderTrigger(containerEl: HTMLElement, trigger: UriTrigger): void {
    containerEl.createEl("h3", { text: trigger.name || "Unnamed trigger" });

    new Setting(containerEl)
      .setName("Enabled")
      .addToggle((toggle) => {
        toggle
          .setValue(trigger.enabled)
          .onChange((enabled) => this.plugin.updateTrigger(trigger.id, { enabled }));
      });

    new Setting(containerEl)
      .setName("Name")
      .addText((text) => {
        text
          .setPlaceholder("Open daily note")
          .setValue(trigger.name)
          .onChange((name) => this.plugin.updateTrigger(trigger.id, { name }));
      });

    new Setting(containerEl)
      .setName("Event")
      .addDropdown((dropdown) => {
        for (const eventName of TRIGGER_EVENTS) {
          dropdown.addOption(eventName, humanizeEvent(eventName));
        }

        dropdown
          .setValue(trigger.event)
          .onChange((eventName) => {
            if (!isTriggerEvent(eventName)) {
              return;
            }

            return this.plugin.updateTrigger(trigger.id, { event: eventName });
          });
      });

    new Setting(containerEl)
      .setName("Path filter")
      .setDesc("Optional. Only run when the file path contains this text.")
      .addText((text) => {
        text
          .setPlaceholder("Projects/")
          .setValue(trigger.pathIncludes)
          .onChange((pathIncludes) => this.plugin.updateTrigger(trigger.id, { pathIncludes }));
      });

    new Setting(containerEl)
      .setName("Obsidian URI")
      .setDesc("Supports {{event}}, {{path}}, {{previousPath}}, {{basename}}, {{name}}, and {{extension}}.")
      .addTextArea((text) => {
        text
          .setPlaceholder("obsidian://advanced-uri?vault=MyVault&commandid=...")
          .setValue(trigger.uriTemplate)
          .onChange((uriTemplate) => this.plugin.updateTrigger(trigger.id, { uriTemplate }));
      });

    new Setting(containerEl)
      .setName("Delete trigger")
      .setDesc("Remove this trigger permanently.")
      .addButton((button) => {
        button
          .setButtonText("Delete")
          .setWarning()
          .onClick(async () => {
            await this.plugin.removeTrigger(trigger.id);
            this.display();
          });
      });
  }
}

function buildUri(template: string, context: TriggerContext): string {
  const replacements: Record<string, string> = {
    basename: context.file.basename,
    event: context.event,
    extension: context.file.extension,
    name: context.file.name,
    path: context.file.path,
    previousPath: context.previousPath
  };

  return Object.entries(replacements).reduce((uri, [key, value]) => {
    return uri.replaceAll(`{{${key}}}`, encodeURIComponent(value));
  }, template);
}

function openObsidianUri(uri: string, triggerName: string): void {
  try {
    window.open(uri);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    new Notice(`URI trigger failed (${triggerName}): ${message}`);
  }
}

function humanizeEvent(eventName: TriggerEvent): string {
  return eventName
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isTriggerEvent(eventName: string): eventName is TriggerEvent {
  return TRIGGER_EVENTS.some((triggerEvent) => triggerEvent === eventName);
}
