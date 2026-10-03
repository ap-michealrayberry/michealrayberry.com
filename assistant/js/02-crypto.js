(function (MRB) {
  "use strict";

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      out += h.length === 1 ? "0" + h : h;
    }
    return out;
  }

  function concatBytes(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  async function sha256Bytes(data) {
    var buf = data instanceof ArrayBuffer ? data : data.buffer
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;
    if (typeof data === "string") {
      buf = new TextEncoder().encode(data);
    }
    var hash = await crypto.subtle.digest("SHA-256", buf);
    return new Uint8Array(hash);
  }

  async function sha256Hex(data) {
    var bytes = await sha256Bytes(data);
    return toHex(bytes);
  }

  /**
   * Rolling chain: seed from challenge code, then per chunk
   * chain = SHA256(chain ‖ chunkBytes). Final hex + count.
   */
  function createHashChain(seedCode) {
    var chainHex = null;
    var chainBytes = null;
    var count = 0;
    var ready = sha256Bytes(String(seedCode)).then(function (b) {
      chainBytes = b;
      chainHex = toHex(b);
    });

    return {
      ready: ready,
      async addChunk(chunk) {
        await ready;
        var chunkBytes =
          chunk instanceof Uint8Array
            ? chunk
            : chunk instanceof ArrayBuffer
              ? new Uint8Array(chunk)
              : new Uint8Array(await new Response(chunk).arrayBuffer());
        var combined = concatBytes(chainBytes, chunkBytes);
        chainBytes = await sha256Bytes(combined);
        chainHex = toHex(chainBytes);
        count += 1;
        return chainHex;
      },
      getFinal: function () {
        return { chain: chainHex, chunk_count: count };
      },
    };
  }

  /** Pure test helper: alter one chunk → different final chain. */
  async function chainFromChunks(seed, chunks) {
    var c = createHashChain(seed);
    await c.ready;
    for (var i = 0; i < chunks.length; i++) {
      await c.addChunk(chunks[i]);
    }
    return c.getFinal();
  }

  MRB.crypto = {
    toHex: toHex,
    sha256Bytes: sha256Bytes,
    sha256Hex: sha256Hex,
    createHashChain: createHashChain,
    chainFromChunks: chainFromChunks,
    concatBytes: concatBytes,
  };
})(window.MRB);
