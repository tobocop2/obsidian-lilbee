import { App, Modal } from "obsidian";
import { bindEscapeToClose } from "../utils";

/** A modal that resolves `result` once: with the button the user picked, or `dismissed` when it closes. */
export class ChoiceModal<T> extends Modal {
    private _resolve: ((value: T) => void) | null = null;
    private decided = false;
    readonly result: Promise<T>;

    constructor(
        app: App,
        private readonly dismissed: T,
    ) {
        super(app);
        this.result = new Promise<T>((resolve) => {
            this._resolve = resolve;
        });
        bindEscapeToClose(this);
    }

    /** A button that settles the modal with *value*. */
    protected addChoice(actions: HTMLElement, text: string, value: T, cta = false): HTMLButtonElement {
        const button = actions.createEl("button", cta ? { text, cls: "mod-cta" } : { text });
        button.addEventListener("click", () => this.decide(value));
        return button;
    }

    onClose(): void {
        this.decide(this.dismissed);
    }

    private decide(value: T): void {
        if (this.decided) return;
        this.decided = true;
        /* v8 ignore next -- `decided` guards re-entry, so `_resolve` is always set here */
        if (this._resolve) {
            const resolve = this._resolve;
            this._resolve = null;
            resolve(value);
        }
        this.close();
    }
}
