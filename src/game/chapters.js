import * as THREE from 'three';

/** Chapter = spawn point + world state + art camera + words. */
export const CHAPTERS = [
  {
    id: 0, numeral: 'I', title: 'The Threshold',
    spawn: { pos: new THREE.Vector3(0, 0, 182), yaw: Math.PI, camYaw: 0 },
    art: { pos: new THREE.Vector3(2, 3.2, 197), look: new THREE.Vector3(5, 4.5, 132) },
    music: 'explore',
    intro: [{ speaker: 'Echo', text: 'You came back. The stone said you would.' }, { speaker: 'Echo', text: 'Find the soft stone. Hold fast, and climb.' }],
    lore: 'Before the valley had a name, the giants walked it — and the stone remembered their weight.',
  },
  {
    id: 1, numeral: 'II', title: 'The Drowned Causeway',
    spawn: { pos: new THREE.Vector3(0, 0, 113), yaw: Math.PI, camYaw: 0 },
    art: { pos: new THREE.Vector3(9, 6, 116), look: new THREE.Vector3(-2, 1, 60) },
    music: 'explore',
    intro: [{ speaker: 'Echo', text: 'The road across the mist is older than the wardens.' }, { speaker: 'Echo', text: 'Listen to the tower. It is tired of standing.' }],
    lore: 'The wardens did not fight the giants. They learned to hold on.',
  },
  {
    id: 2, numeral: 'III', title: 'The Warden of the Basin',
    spawn: { pos: new THREE.Vector3(0, 0, 12), yaw: Math.PI, camYaw: 0 },
    art: { pos: new THREE.Vector3(-22, 4, -30), look: new THREE.Vector3(0, 12, -118) },
    music: 'explore',
    intro: [{ speaker: 'Echo', text: 'It sleeps where the light pools. It will not sleep long.' }, { speaker: 'Echo', text: 'Moss grows only where stone is still. Look for where it grows.' }],
    lore: 'Two marks were cut into the Warden when it was made: one for the back that bears, one for the crown that remembers.',
    boss: 'warden',
  },
  {
    id: 3, numeral: 'IV', title: 'The Strider of the High Meadow',
    // you wake on the plaza between the effigies; the meadow lies west, through the fallen wall
    spawn: { pos: new THREE.Vector3(0, 0, 175.5), yaw: -Math.PI / 2, camYaw: Math.PI / 2 },
    art: { pos: new THREE.Vector3(-70, 9, 148), look: new THREE.Vector3(-112, 5, 162) },
    music: 'explore',
    intro: [{ speaker: 'Echo', text: 'Another waits where the sun goes down, past the fallen wall.' }, { speaker: 'Echo', text: 'It will not stoop for you. Make it strike the stones.' }],
    lore: 'The second warden was made to run the high meadow and never stop. The standing stones were raised to stop it.',
    boss: 'strider',
  },
];

/** Which effigy stands for which warden, and the chapter that warden is fought in. */
export const WARDENS = [
  {
    id: 'warden', chapter: 2, effigy: { x: 6, z: 171, yaw: -Math.PI / 2, scale: 0.13, plinth: [2.4, 1.3, 2.4] },
    lines: {
      awaken: 'It knows you are here.',
      sigil: { crown: 'The back mark is gone, and the crown has woken. Get to its shoulders.', back: 'One mark fades. The back still bears the other.' },
      victory: 'It remembers now. So will you.',
      events: {
        sealed: 'Its crown is sealed. Something else must break first.',
        rub: 'It means to grind you off against the wall. Up, to the shoulders!',
        wall: 'The wall is down. Nothing left to scrape you against.',
      },
    },
  },
  {
    id: 'strider', chapter: 3, effigy: { x: -6, z: 171, yaw: Math.PI / 2, scale: 0.19, plinth: [2.2, 1.1, 4.6] },
    lines: {
      awaken: 'It is awake. Do not let it see you.',
      sigil: { nape: 'One mark gone. The other is on its neck, behind the horns.', croup: 'One mark gone, and it is wild now. The other lies under the plate on its back.' },
      victory: 'The meadow is still. It will not run again.',
      hint: ['It goes to the water to drink. Keep the stones between you, and come at it while its head is down.', 'Hold on at the front of its neck and lean, left or right. It will run where you turn it.'],
      events: {
        spotted: 'It has seen you. Put a stone between you, and it will lose you.',
        drinking: 'It is drinking. Go now. Walk, do not run.',
        staggered: 'Stone will not bring it to its knees. Only thirst will. Wait for it at the water.',
        mounted: 'You have it. Hold on.',
        ram: 'Again. The plate on its back is splitting.',
        armour: 'The plate is broken. The mark is bare.',
        winded: 'It is spent. Its head is down. Now.',
      },
    },
  },
];

export const MENU_VIEW = {
  pos: new THREE.Vector3(-4, 8.5, 123), look: new THREE.Vector3(6, 5, 0),
  drift: new THREE.Vector3(3, 0.6, -2),
};

export const CREDITS = [
  { role: '', names: ['MONOLITH'] , title: true },
  { role: 'Echoes of the Colossus', names: [] },
  { role: 'Direction & Design', names: ['The Monolith Team'] },
  { role: 'World & Interface', names: ['Built with Three.js'] },
  { role: 'Typography', names: ['Cormorant Garamond', 'Jost'] },
  { role: 'Sound', names: ['Every sound synthesised in the browser'] },
  { role: 'Engineering', names: ['Vite · Three.js · Web Audio · Gamepad API'] },
  { role: 'With gratitude to', names: ['Everyone who stops to look at the view'] },
  { role: '', names: ['Thank you for playing.'], end: true },
];
