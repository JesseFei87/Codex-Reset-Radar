class LoginClientCache {
  constructor(createClient) {
    this.createClient = createClient;
    this.key = null;
    this.client = null;
    this.pending = null;
    this.generation = 0;
  }

  async warm(key, options) {
    if (this.client && this.key === key) return this.client;
    if (this.pending && this.key === key) return this.pending;
    this.close();
    const generation = this.generation;
    this.key = key;
    this.pending = this.createClient(options).then((client) => {
      if (generation !== this.generation) {
        client.close();
        throw new Error('Codex login client warmup was superseded');
      }
      this.client = client;
      this.pending = null;
      return client;
    }).catch((error) => {
      if (generation === this.generation) {
        this.key = null;
        this.pending = null;
      }
      throw error;
    });
    return this.pending;
  }

  async take(key, options) {
    const client = await this.warm(key, options);
    this.key = null;
    this.client = null;
    this.pending = null;
    return client;
  }

  close() {
    this.generation += 1;
    this.client?.close();
    this.key = null;
    this.client = null;
    this.pending = null;
  }
}

module.exports = { LoginClientCache };
