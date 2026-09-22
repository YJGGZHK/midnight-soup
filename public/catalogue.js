export function filterPuzzles(puzzles, { query = '', genre = '', difficulty = '', gentle = false } = {}) {
  const title = query.trim().toLocaleLowerCase();
  return puzzles.filter(p => p.title.toLocaleLowerCase().includes(title)
    && (!genre || p.genre === genre)
    && (!difficulty || p.difficulty === difficulty)
    && (!gentle || p.warnings.length === 0));
}

export function randomPuzzle(puzzles, currentId) {
  const other = puzzles.filter(p => p.id !== currentId);
  const candidates = other.length ? other : puzzles;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
