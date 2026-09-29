export default {
  test: {
    include: ['src/**/*.spec.ts'],
    pool: 'vmThreads',
    teardownTimeout: 5000,
  },
}
