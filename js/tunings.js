/* Fretscape — preset tunings. MIDI note numbers, lowest string first. */
(function () {
  'use strict';
  const FS = (window.FS = window.FS || {});

  // flats: label the strings with flat names (E♭ A♭ …) instead of sharps.
  const T = (id, strings, name, notes, flats) => ({ id, strings, name, notes, flats: !!flats });

  FS.TUNINGS = [
    // 6-string guitar
    T('std6', 6, 'Standard', [40, 45, 50, 55, 59, 64]),
    T('half6', 6, 'Half Step Down (E♭)', [39, 44, 49, 54, 58, 63], true),
    T('dstd6', 6, 'Whole Step Down (D)', [38, 43, 48, 53, 57, 62]),
    T('cstd6', 6, 'C Standard', [36, 41, 46, 51, 55, 60], true),
    T('dropd6', 6, 'Drop D', [38, 45, 50, 55, 59, 64]),
    T('dropcs6', 6, 'Drop C♯', [37, 44, 49, 54, 58, 63]),
    T('dropc6', 6, 'Drop C', [36, 43, 48, 53, 57, 62]),
    T('dropb6', 6, 'Drop B', [35, 42, 47, 52, 56, 61]),
    T('dadgad6', 6, 'DADGAD', [38, 45, 50, 55, 57, 62]),
    T('opend6', 6, 'Open D', [38, 45, 50, 54, 57, 62]),
    T('opendm6', 6, 'Open D Minor', [38, 45, 50, 53, 57, 62]),
    T('openg6', 6, 'Open G', [38, 43, 50, 55, 59, 62]),
    T('opene6', 6, 'Open E', [40, 47, 52, 56, 59, 64]),
    T('opena6', 6, 'Open A', [40, 45, 52, 57, 61, 64]),
    T('openc6', 6, 'Open C', [36, 43, 48, 55, 60, 64]),
    // 7-string guitar
    T('std7', 7, 'Standard (B)', [35, 40, 45, 50, 55, 59, 64]),
    T('dropa7', 7, 'Drop A', [33, 40, 45, 50, 55, 59, 64]),
    T('half7', 7, 'Half Step Down (B♭)', [34, 39, 44, 49, 54, 58, 63], true),
    T('dropgs7', 7, 'Drop G♯', [32, 39, 44, 49, 54, 58, 63]),
    T('astd7', 7, 'A Standard', [33, 38, 43, 48, 53, 57, 62]),
    T('dropg7', 7, 'Drop G', [31, 38, 43, 48, 53, 57, 62]),
    // 8-string guitar
    T('std8', 8, 'Standard (F♯)', [30, 35, 40, 45, 50, 55, 59, 64]),
    T('drope8', 8, 'Drop E', [28, 35, 40, 45, 50, 55, 59, 64]),
    T('half8', 8, 'Half Step Down (F)', [29, 34, 39, 44, 49, 54, 58, 63], true),
    T('dropeb8', 8, 'Drop E♭', [27, 34, 39, 44, 49, 54, 58, 63], true),
    T('estd8', 8, 'E Standard', [28, 33, 38, 43, 48, 53, 57, 62]),
    T('dropd8', 8, 'Drop D', [26, 33, 38, 43, 48, 53, 57, 62]),
    // 4-string bass
    T('std4', 4, 'Standard', [28, 33, 38, 43]),
    T('half4', 4, 'Half Step Down (E♭)', [27, 32, 37, 42], true),
    T('dropd4', 4, 'Drop D', [26, 33, 38, 43]),
    T('dstd4', 4, 'D Standard', [26, 31, 36, 41]),
    T('dropc4', 4, 'Drop C', [24, 31, 36, 41]),
    // 5-string bass
    T('std5', 5, 'Standard (B)', [23, 28, 33, 38, 43]),
    T('highc5', 5, 'High C (EADGC)', [28, 33, 38, 43, 48]),
    T('half5', 5, 'Half Step Down (B♭)', [22, 27, 32, 37, 42], true),
    T('dropa5', 5, 'Drop A', [21, 28, 33, 38, 43]),
  ];

  FS.STRING_OPTIONS = [
    [4, '4 (Bass)'],
    [5, '5 (Bass)'],
    [6, '6'],
    [7, '7'],
    [8, '8'],
  ];

  FS.FRET_OPTIONS = [21, 22, 24];
})();
