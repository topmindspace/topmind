import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const docsImgDir = path.join(rootDir, 'docs', 'images');
const rawImgDir = path.join(rootDir, 'topmind-desktop', 'resources', 'img');

// Ensure directories exist
if (!fs.existsSync(docsImgDir)) {
  fs.mkdirSync(docsImgDir, { recursive: true });
}

const FFMPEG = '/opt/homebrew/bin/ffmpeg';

console.log("Compositing high-resolution UI screenshots into full-color scenes...");

const tempDir = path.join(docsImgDir, 'temp_video');
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

// Raw PNG source files
const imgStreamAi = path.join(rawImgDir, 'Stream-AI建议.png');
const imgStream = path.join(rawImgDir, 'Stream.png');
const imgEditor = path.join(rawImgDir, '文章查看-编辑器.png');
const imgQuicknote = path.join(rawImgDir, 'quicknote.png');
const imgAiSuggest = path.join(rawImgDir, 'AI建议.png');
const imgIngest = path.join(rawImgDir, '知识加工.png');

// Structured scenes using high-fidelity raw PNG sources
const scenes = [
  {
    id: 1,
    title: 'Personal Stream · 动态主表面 + AI 智能建议',
    type: 'single_window',
    img: imgStreamAi
  },
  {
    id: 2,
    title: '时间轴 · Personal Stream 流式全景',
    type: 'single_window',
    img: imgStream
  },
  {
    id: 3,
    title: 'Quiet Paper · 专注 Markdown 深度编辑器',
    type: 'single_window',
    img: imgEditor
  },
  {
    id: 4,
    title: '⌘N 极速捕获 + 侧栏 Agent 确认',
    type: 'split_vertical',
    imgLeft: imgQuicknote,
    imgRight: imgAiSuggest
  },
  {
    id: 5,
    title: '00-收件箱 · 缓冲与整理',
    type: 'single_window',
    img: imgStream
  },
  {
    id: 6,
    title: '多源知识加工队列 · Word / PDF / Mail',
    type: 'split_vertical',
    imgLeft: imgIngest,
    imgRight: imgStreamAi
  },
  {
    id: 7,
    title: '行内 AI 润色 · 自动消除思考标签',
    type: 'single_window',
    img: imgEditor
  },
  {
    id: 8,
    title: 'AI 待办自动维护 & 写闸确认',
    type: 'split_vertical',
    imgLeft: imgQuicknote,
    imgRight: imgAiSuggest
  },
  {
    id: 9,
    title: '88-输出 · 交付成品沉淀',
    type: 'single_window',
    img: imgEditor
  },
  {
    id: 10,
    title: '设置中心 · 通用偏好 & 工作区契约',
    type: 'split_vertical',
    imgLeft: imgStreamAi,
    imgRight: imgIngest
  },
  {
    id: 11,
    title: '设置中心 · 知识加工 & 微信读书同步',
    type: 'split_vertical',
    imgLeft: imgIngest,
    imgRight: imgStream
  },
  {
    id: 12,
    title: '设置中心 · Agent Skills & 插件扩展',
    type: 'split_vertical',
    imgLeft: imgAiSuggest,
    imgRight: imgQuicknote
  },
  {
    id: 13,
    title: '本地优先 · Agent 个人动态流全貌',
    type: 'single_window',
    img: imgStreamAi
  }
];

const clipPaths = [];

scenes.forEach((scene, index) => {
  const clipPath = path.join(tempDir, `scene_${String(index + 1).padStart(2, '0')}.mp4`);
  console.log(`Rendering Scene ${index + 1}/${scenes.length}: ${scene.title}`);

  // No drawtext filter (ffmpeg build may not have libfreetype) — scenes are self-explanatory

  let ffmpegCmd = '';
  if (scene.type === 'single_window') {
    // Standard full width single screen with title bar
    const filterGraph = [
      `scale=1800:1000:force_original_aspect_ratio=decrease,`,
      `pad=1920:1080:(1920-iw)/2:(1080-ih)/2+15:color=#0b0f17,`,
      `fade=t=in:st=0:d=0.5,fade=t=out:st=4.0:d=0.5`
    ].join('');

    ffmpegCmd = [
      `${FFMPEG} -y -loop 1 -i`,
      `"${scene.img}"`,
      `-filter_complex "${filterGraph}"`,
      `-c:v libx264 -t 4.5 -pix_fmt yuv420p -r 30`,
      `"${clipPath}"`
    ].join(' ');
  } else if (scene.type === 'split_vertical') {
    // Two cards side by side with title bar
    const filterGraph = [
      `[0:v]scale=840:920:force_original_aspect_ratio=decrease,pad=880:940:(880-iw)/2:(940-ih)/2:color=#1e293b[l];`,
      `[1:v]scale=840:920:force_original_aspect_ratio=decrease,pad=880:940:(880-iw)/2:(940-ih)/2:color=#1e293b[r];`,
      `[l][r]hstack=inputs=2[cards];`,
      `[cards]pad=1920:1080:(1920-iw)/2:(1080-ih)/2+15:color=#0b0f17,`,
      `fade=t=in:st=0:d=0.5,fade=t=out:st=4.0:d=0.5[v]`
    ].join('');

    ffmpegCmd = [
      `${FFMPEG} -y -loop 1`,
      `-i "${scene.imgLeft}" -loop 1 -i "${scene.imgRight}"`,
      `-filter_complex "${filterGraph}"`,
      `-map "[v]" -c:v libx264 -t 4.5 -pix_fmt yuv420p -r 30`,
      `"${clipPath}"`
    ].join(' ');
  }

  execSync(ffmpegCmd, { stdio: 'pipe' });
  clipPaths.push(clipPath);
});

// Concat list
const listPath = path.join(tempDir, 'files.txt');
fs.writeFileSync(listPath, clipPaths.map(p => `file '${p}'`).join('\n'));

const finalMp4 = path.join(docsImgDir, 'topmind-demo.mp4');
const finalWebm = path.join(docsImgDir, 'topmind-demo.webm');
const finalGif = path.join(docsImgDir, 'topmind-demo.gif');

console.log(`\nConcatenating ${scenes.length} scenes into HD MP4 video...`);
execSync(`${FFMPEG} -y -f concat -safe 0 -i "${listPath}" -c copy "${finalMp4}"`, { stdio: 'inherit' });

console.log("Generating WebM video...");
execSync(`${FFMPEG} -y -i "${finalMp4}" -c:v libvpx-vp9 -b:v 1.2M "${finalWebm}"`, { stdio: 'inherit' });

console.log("Generating high-fidelity GIF (two-pass palette, 800px, 12fps)...");
// Two-pass palette approach for best color fidelity:
// 1. Generate optimal palette from the entire video using stats_mode=diff
// 2. Apply palette with sierra2_4a dithering for smooth gradients
// Width 800px + 12fps = good balance of quality and file size (~6-10MB)
const palettePath = path.join(tempDir, 'palette.png');
execSync(
  `${FFMPEG} -y -i "${finalMp4}" -vf "fps=12,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=256:reserve_transparent=0" -update 1 -frames:v 1 "${palettePath}"`,
  { stdio: 'inherit' }
);
execSync(
  `${FFMPEG} -y -i "${finalMp4}" -i "${palettePath}" -filter_complex "[0:v]fps=12,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" "${finalGif}"`,
  { stdio: 'inherit' }
);

// Cleanup temp dir
fs.rmSync(tempDir, { recursive: true, force: true });

// Report file sizes
const mp4Size = (fs.statSync(finalMp4).size / 1024 / 1024).toFixed(1);
const webmSize = (fs.statSync(finalWebm).size / 1024 / 1024).toFixed(1);
const gifSize = (fs.statSync(finalGif).size / 1024 / 1024).toFixed(1);

console.log(`\nSUCCESS: ${scenes.length} scenes, 4.5s/scene, smooth 0.5s fade transitions`);
console.log(`MP4  (~60s): ${finalMp4} (${mp4Size} MB)`);
console.log(`WebM (~60s): ${finalWebm} (${webmSize} MB)`);
console.log(`GIF  (~60s): ${finalGif} (${gifSize} MB)`);
