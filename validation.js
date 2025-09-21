// Validation module
import { deepClone } from './utils.js';

export function validateTimer(timer){
  const errors = [];
  const blocks = deepClone(timer.blocks).sort((a,b)=>a.atSeconds-b.atSeconds);
  if (blocks.length===0) errors.push('Add at least one block.');

  // Ensure first block always starts at 0
  if (blocks.length > 0) {
    blocks[0].atSeconds = 0;
  }

  for(let i=0;i<blocks.length;i++){
    const b = blocks[i];
    if (i > 0 && b.atSeconds < 0) errors.push(`Block ${i+1}: time cannot be negative.`);
    if (!/^#?[0-9A-Fa-f]{6}$/.test(b.colorHex)) errors.push(`Block ${i+1}: invalid color.`);
    if (i>0 && b.atSeconds === blocks[i-1].atSeconds) errors.push(`Duplicate time at ${b.atSeconds}s.`);
    if (i>0 && b.atSeconds < blocks[i-1].atSeconds) errors.push('Blocks must be in ascending time order.');
  }
  return { ok: errors.length===0, errors };
}