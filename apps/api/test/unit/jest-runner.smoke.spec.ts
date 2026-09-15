describe('Jest TypeScript runner', () => {
  it('executes a TypeScript test in the Node environment', () => {
    expect(typeof process.versions.node).toBe('string');
  });
});
