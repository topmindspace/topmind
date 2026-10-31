import fs from "node:fs";

const names = Object.freeze({
  a: "creation-cover-4x4.png",
  b: "creation-cover-4x4-b.png",
  c: "creation-cover-4x4-c.png",
  d: "creation-cover-4x4-d.png",
  e: "creation-cover-4x4-e.png",
  jpeg: "creation-cover-4x4.jpg",
  webp: "creation-cover-4x4.webp",
});

export function coverFixture(name = "a") {
  if (!Object.hasOwn(names, name)) throw new Error(`Unknown cover fixture: ${name}`);
  return fs.readFileSync(new URL(`../fixtures/${names[name]}`, import.meta.url));
}
