import {
  App,
  Modal,
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

type TriggerModalMode = "create" | "edit";

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

  createDefaultTrigger(): UriTrigger {
    return {
      ...DEFAULT_TRIGGER,
      id: crypto.randomUUID()
    };
  }

  async saveTrigger(triggerToSave: UriTrigger): Promise<void> {
    const existingTrigger = this.settings.triggers.find((trigger) => trigger.id === triggerToSave.id);

    if (existingTrigger) {
      this.settings.triggers = this.settings.triggers.map((trigger) => {
        if (trigger.id === triggerToSave.id) {
          return triggerToSave;
        }

        return trigger;
      });
    } else {
      this.settings.triggers = [...this.settings.triggers, triggerToSave];
    }

    await this.saveSettings();
  }

  async removeTrigger(id: string): Promise<void> {
    this.settings.triggers = this.settings.triggers.filter((trigger) => trigger.id !== id);
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
      .setDesc("Open the trigger form.")
      .addButton((button) => {
        button
          .setButtonText("Add")
          .setCta()
          .onClick(() => {
            new UriTriggerModal(
              this.app,
              this.plugin.createDefaultTrigger(),
              "create",
              async (trigger) => {
                await this.plugin.saveTrigger(trigger);
                this.display();
              }
            ).open();
          });
      });

    if (this.plugin.settings.triggers.length === 0) {
      containerEl.createEl("p", { text: "No triggers yet." });
      return;
    }

    for (const trigger of this.plugin.settings.triggers) {
      this.renderTrigger(containerEl, trigger);
    }
  }

  private renderTrigger(containerEl: HTMLElement, trigger: UriTrigger): void {
    new Setting(containerEl)
      .setName(trigger.name || "Unnamed trigger")
      .setDesc(buildTriggerDescription(trigger))
      .addToggle((toggle) => {
        toggle
          .setValue(trigger.enabled)
          .onChange(async (enabled) => {
            await this.plugin.saveTrigger({
              ...trigger,
              enabled
            });
            this.display();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Edit")
          .onClick(() => {
            new UriTriggerModal(this.app, trigger, "edit", async (updatedTrigger) => {
              await this.plugin.saveTrigger(updatedTrigger);
              this.display();
            }).open();
          });
      })
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

class UriTriggerModal extends Modal {
  private trigger: UriTrigger;

  constructor(
    app: App,
    trigger: UriTrigger,
    private readonly mode: TriggerModalMode,
    private readonly onSubmit: (trigger: UriTrigger) => Promise<void>
  ) {
    super(app);
    this.trigger = { ...trigger };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      text: this.mode === "create" ? "Add URI trigger" : "Edit URI trigger"
    });

    new Setting(contentEl)
      .setName("Name")
      .addText((text) => {
        text
          .setPlaceholder("Open daily note")
          .setValue(this.trigger.name)
          .onChange((name) => {
            this.trigger = {
              ...this.trigger,
              name
            };
          });
      });

    new Setting(contentEl)
      .setName("Enabled")
      .addToggle((toggle) => {
        toggle
          .setValue(this.trigger.enabled)
          .onChange((enabled) => {
            this.trigger = {
              ...this.trigger,
              enabled
            };
          });
      });

    new Setting(contentEl)
      .setName("Event")
      .addDropdown((dropdown) => {
        for (const eventName of TRIGGER_EVENTS) {
          dropdown.addOption(eventName, humanizeEvent(eventName));
        }

        dropdown
          .setValue(this.trigger.event)
          .onChange((eventName) => {
            if (!isTriggerEvent(eventName)) {
              return;
            }

            this.trigger = {
              ...this.trigger,
              event: eventName
            };
          });
      });

    new Setting(contentEl)
      .setName("Path filter")
      .setDesc("Optional. Only run when the file path contains this text.")
      .addText((text) => {
        text
          .setPlaceholder("Projects/")
          .setValue(this.trigger.pathIncludes)
          .onChange((pathIncludes) => {
            this.trigger = {
              ...this.trigger,
              pathIncludes
            };
          });
      });

    new Setting(contentEl)
      .setName("Obsidian URI")
      .setDesc("Supports {{event}}, {{path}}, {{previousPath}}, {{basename}}, {{name}}, and {{extension}}.")
      .addTextArea((text) => {
        text
          .setPlaceholder("obsidian://advanced-uri?vault=MyVault&commandid=...")
          .setValue(this.trigger.uriTemplate)
          .onChange((uriTemplate) => {
            this.trigger = {
              ...this.trigger,
              uriTemplate
            };
          });
      });

    new Setting(contentEl)
      .addButton((button) => {
        button
          .setButtonText("Cancel")
          .onClick(() => {
            this.close();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            if (!this.trigger.name.trim()) {
              new Notice("Trigger name is required.");
              return;
            }

            if (!this.trigger.uriTemplate.trim()) {
              new Notice("Obsidian URI is required.");
              return;
            }

            await this.onSubmit({
              ...this.trigger,
              name: this.trigger.name.trim(),
              pathIncludes: this.trigger.pathIncludes.trim(),
              uriTemplate: this.trigger.uriTemplate.trim()
            });
            this.close();
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();
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

function buildTriggerDescription(trigger: UriTrigger): string {
  const state = trigger.enabled ? "Enabled" : "Disabled";
  const pathFilter = trigger.pathIncludes ? `Path contains "${trigger.pathIncludes}"` : "All paths";

  return `${humanizeEvent(trigger.event)} - ${state} - ${pathFilter}`;
}
