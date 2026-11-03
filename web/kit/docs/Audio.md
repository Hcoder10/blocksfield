# Audio (audio.js)

Music with crossfade and gapless loop, sound effects with pitch variation, and good-sounding procedural WebAudio
fallbacks so a game is **never silent**. Audio unlocks on the first key/click (browser autoplay rule) by itself.
**`Audio.auto(game)` plays the right sound for every CONTRACT event and starts `music_main`.**

```js
Audio.auto(game, { music: true, map: { jump: 'boing' } })   // call once
Audio.music(game, urlOrName, { volume: 1, loop: true, fade: 1.5, style }) -> handle.stop(fade)
Audio.sfx(game, nameOrUrl, { volume: 1, pitchVariation: 0.06, rate: 1 })
Audio.stopMusic(fade)  Audio.duck(on)  Audio.volume({ master, music, sfx })  Audio.mute(bool) Audio.isMuted()
Audio.SFX   // built-in names: coin gem star jump land step boost whoosh hit hurt explosion checkpoint powerup win lose
            //                 death respawn click hover tick go banner open splash
```

## Which file plays

`Audio.sfx(game, 'jump')` tries, in order: an asset named `sfx_jump`, an asset named `jump` (variants `_2`, `_3`
are picked at random), a manifest sfx tagged `"event": "jump"`, then the built-in synth `jump`.
`Audio.music(game, 'music_main')` / `Audio.music(game, game.asset('music_main'))`: if there is no file it plays a
gentle procedural groove (`style`: `'arcade' | 'cozy' | 'dark' | 'scifi'`); pass `{ procedural: false }` for silence.

## What Audio.auto does

| event | sound |
|---|---|
| `collect(item)` | sfx named after `item.tag` if generated (gem, key...), else the `collect` sfx, else built-in coin |
| `jump`, `land` (scaled by speed), `boost`, `damage` (hit), `death`, `respawn`, `checkpoint`, `lap`, `goal` | matching sfx |
| `win` / `lose` | fanfare / sad trombone, music ducks |
| `pause(true)` | music muffled (low-pass) until unpaused |
| UI | clicks, hovers, countdown ticks, GO!, banner whooshes, star pops |

## Examples

```js
K.Audio.auto(game);                                   // everything, including music_main
K.Audio.music(game, 'music_boss', { fade: 0.8 });     // crossfade to another track
K.Audio.sfx(game, 'powerup');
K.Audio.auto(game, { map: { collect: 'gem' } });      // different default pickup sound
```

## Common mistakes

- Calling `Audio.sfx` for events `Audio.auto` already covers: doubled sounds.
- Expecting sound before any input: browsers block audio until the first key/click; it starts then.
- Passing a file path that doesn't exist: you get an error in `__kit.errors`; use `game.asset(name)` or a name.
