---
name: video-editing
description: Recipes and rules for cutting, cropping, captioning, and normalizing video with ffmpeg inside the ffmpeg-sandbox connector. Load this whenever a task involves editing, trimming, resizing, or exporting video or audio.
---

# Video editing with ffmpeg

All work happens through the `ffmpeg-sandbox` connector. Never use bash, `ls`, or any
built-in sandbox tools for media files; they cannot see the media workspace.

Tools available:
- `list_media`: what is in the workspace
- `probe_media`: duration, resolution, codecs, fps
- `run_ffmpeg`: run ffmpeg with an argument array
- `run_python`: glue work, parsing, arithmetic

## Rules

**Probe before you cut.** Never assume resolution, duration, or frame rate. Call
`probe_media` first and base every crop and timestamp on what it returns.

**Paths are relative to the workspace.** `source.mp4`, not `/Users/...` and not a URL.
The sandbox has no network access.

**Dimensions must be even.** H.264 rejects odd width or height. When a computed crop
lands on an odd number, round down. `crop=ih*9/16:ih` on a 1920x1080 source gives
607.5, so ffmpeg's own rounding produces 608, and you should always verify with a probe
afterwards.

**Verify every render.** After any command that produces a file, probe the output and
confirm duration and resolution match the intent. A command that exits 0 can still
produce a broken file.

**Put `-ss` before `-i` for speed, after `-i` for accuracy.** Before the input, ffmpeg
seeks to the nearest keyframe (fast, can be off by a second). After the input, it
decodes to the exact frame (slow, frame-accurate). For social clips, accuracy wins.

**Don't re-encode when you don't have to.** `-c copy` is near-instant but can only cut
on keyframes. Use it for rough passes, re-encode for final output.

## Recipes

### Trim a segment
```
["-i","source.mp4","-ss","20","-t","15","-c:v","libx264","-c:a","aac","clip.mp4"]
```
`-ss` is the start, `-t` is the duration (not the end time).

### Crop to 9:16 vertical (centre)
```
["-i","source.mp4","-vf","crop=ih*9/16:ih","-c:a","copy","vertical.mp4"]
```
Takes the full height and a centred slice of the width. For a 1080p source this
produces 608x1080.

### Crop to 9:16 and pad to a clean 1080x1920
```
["-i","source.mp4","-vf","crop=ih*9/16:ih,scale=1080:1920","-c:a","copy","out.mp4"]
```
Use this when the platform expects exactly 1080x1920.

### Blurred-background vertical (keeps the whole frame visible)
```
["-i","source.mp4","-filter_complex",
 "[0:v]scale=1080:1920,boxblur=20:5[bg];[0:v]scale=1080:-1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2",
 "-c:a","copy","out.mp4"]
```
Better than a hard crop when faces or text sit near the edges of the frame.

### Extract audio for transcription
```
["-i","source.mp4","-vn","-ac","1","-ar","16000","-c:a","pcm_s16le","audio.wav"]
```
Mono 16 kHz is what speech models expect and keeps the file small.

### Burn in subtitles from an SRT
```
["-i","clip.mp4","-vf","subtitles=captions.srt:force_style='FontSize=18,Alignment=2,MarginV=60'","-c:a","copy","captioned.mp4"]
```
`Alignment=2` is bottom-centre. Raise `MarginV` to lift captions above platform UI.

### Normalize loudness
```
["-i","clip.mp4","-af","loudnorm=I=-14:TP=-1.5:LRA=11","-c:v","copy","normalized.mp4"]
```
-14 LUFS is the common target for social platforms.

### Find silence (to cut dead air)
```
["-i","source.mp4","-af","silencedetect=noise=-30dB:d=0.5","-f","null","-"]
```
Writes nothing; the silence ranges appear in stderr. Parse them with `run_python`,
then build a trim list from what you find.

### Grab a thumbnail
```
["-i","clip.mp4","-ss","2","-vframes","1","thumb.jpg"]
```

### Fade in and out
```
["-i","clip.mp4","-vf","fade=t=in:st=0:d=0.5,fade=t=out:st=14.5:d=0.5","-c:a","copy","faded.mp4"]
```
The fade-out `st` must be the clip duration minus the fade length, so probe first.

### Concatenate clips
Write a list file with `run_python`:
```
file 'clip1.mp4'
file 'clip2.mp4'
```
Then:
```
["-f","concat","-safe","0","-i","list.txt","-c","copy","joined.mp4"]
```
Only works when the clips share codec, resolution, and frame rate. Otherwise
re-encode each one to a common format first.

## Working on several clips

When a job produces multiple clips, render them one command at a time rather than
chaining filters into a single call. Each render is independently verifiable, and a
failure on clip three doesn't lose clips one and two.

## Before anything irreversible

Overwriting a source file, deleting media, or exporting for publication needs human
confirmation. Render to a new filename, show the result, and ask.
