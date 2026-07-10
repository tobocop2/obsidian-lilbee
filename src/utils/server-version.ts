import { MESSAGES } from "../locales/en";
import { VERSION_ACTION, type VersionAction } from "../types";

/**
 * How installing *selectedTag* relates to *installedTag*, given release tags
 * newest-first. An installed tag missing from the list (yanked release, hand
 * -installed build) has no ordering, so any choice is a plain install.
 */
export function versionActionFor(tagsNewestFirst: string[], installedTag: string, selectedTag: string): VersionAction {
    const installedIdx = tagsNewestFirst.indexOf(installedTag);
    const selectedIdx = tagsNewestFirst.indexOf(selectedTag);
    if (installedIdx === -1 || selectedIdx === -1) return VERSION_ACTION.INSTALL;
    if (selectedIdx === installedIdx) return VERSION_ACTION.REINSTALL;
    return selectedIdx < installedIdx ? VERSION_ACTION.UPDATE : VERSION_ACTION.DOWNGRADE;
}

export function versionButtonLabel(action: VersionAction, selectedTag: string): string {
    switch (action) {
        case VERSION_ACTION.REINSTALL:
            return MESSAGES.BUTTON_REINSTALL;
        case VERSION_ACTION.UPDATE:
            return MESSAGES.BUTTON_UPDATE_TO(selectedTag);
        case VERSION_ACTION.DOWNGRADE:
            return MESSAGES.BUTTON_DOWNGRADE_TO(selectedTag);
        default:
            return MESSAGES.BUTTON_INSTALL_TAG(selectedTag);
    }
}

export function versionDescription(
    action: VersionAction,
    installedTag: string,
    selectedTag: string,
    installedIsLatest: boolean,
): string {
    if (!installedTag) return MESSAGES.DESC_SERVER_VERSION_UNKNOWN;
    switch (action) {
        case VERSION_ACTION.UPDATE:
            return MESSAGES.DESC_SERVER_VERSION_UPDATE(installedTag, selectedTag);
        case VERSION_ACTION.DOWNGRADE:
            return MESSAGES.DESC_SERVER_VERSION_DOWNGRADE(installedTag);
        case VERSION_ACTION.REINSTALL:
            return installedIsLatest
                ? MESSAGES.DESC_SERVER_VERSION_INSTALLED(installedTag)
                : MESSAGES.DESC_SERVER_VERSION_OUTDATED(installedTag);
        default:
            return MESSAGES.DESC_SERVER_VERSION_PLAIN(installedTag);
    }
}
