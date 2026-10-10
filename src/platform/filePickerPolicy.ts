export const AUDIO_FILE_ACCEPT = "audio/*,.flac,.aiff,.aif";
export const LIBRARY_FILE_ACCEPT = `${AUDIO_FILE_ACCEPT},.lrc,.txt`;

type PickerNavigator = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">;

/** iOS advertises webkitdirectory even in versions where it has no effect. */
export function filePickerPolicy(navigator: PickerNavigator, hasDirectoryInput: boolean) {
  const isIOS = /iPad|iPhone|iPod/u.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const version = isIOS ? /OS (\d+)[_.](\d+)/u.exec(navigator.userAgent)
    ?? /Version\/(\d+)(?:\.(\d+))?/u.exec(navigator.userAgent) : null;
  const hasIOSDirectories = !!version && (Number(version[1]) > 18
    || (Number(version[1]) === 18 && Number(version[2] ?? 0) >= 4));
  return {
    isIOS,
    supportsDirectories: !isIOS || (hasDirectoryInput && hasIOSDirectories),
    // WebKit bug 242110: audio/* can hide audio files in the Files picker.
    // Unfiltered document selection also works with cloud-provider MIME types;
    // the import handlers still validate extensions/types and size limits.
    audioAccept: isIOS ? undefined : AUDIO_FILE_ACCEPT,
    libraryAccept: isIOS ? undefined : LIBRARY_FILE_ACCEPT,
    lyricsAccept: isIOS ? undefined : ".lrc,.txt,text/plain",
  };
}
