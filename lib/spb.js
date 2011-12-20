// Size-prefixed blob format. This is similar to e.g.,
// http://rfc.zeromq.org/spec:2, with two differences: there's no
// 'extensions' byte, and sizes are represented by either one byte or
// four bytes, rather than one or eight. Why this latter? Because the
// largest integer JavaScript can represent exactly is 2^53, or
// 9007199254740992; and in any case, the largest buffer or string one
// can allocate is usually rather smaller than 4GB.

var twoTo24 = (1 << 24);

function readsize(buffer0, offset) {
    var buffer = (offset) ? buffer0.slice(offset) : buffer0;
    return (buffer[0] * twoTo24) +
        (buffer[1] << 16) +
        (buffer[2] << 8) +
        buffer[3];
}
module.exports.readsize = readsize;

function BlobStream(underlying) {

    this._underlying = underlying;
    this._encoding = null;
    var that = this;

    function end() {
        that.readable = that.writable = false;
        that.emit('end');
    }

    function error(exception) {
        that.readable = that.writable = false;
        that.emit('error', exception);
    }

    function close() {
        that.emit('close');
    }

    function drain() {
        that.emit('drain');
    }

    function pipe(src) {
        that.emit('pipe', src);
    }

    // ------ helpers
    var zero = new Buffer(0);
    function output_zero() {
        output(zero);
    }

    function output(buffer) {
        var encoding = that._encoding;
        that.emit('data', (encoding) ? buffer.toString(encoding) : buffer);
    }

    function outputv(size, buffers) {
        var out = new Buffer(size);
        var offset = 0;
        var len = buffers.length;
        for (var i = 0; i < len; i++) {
            buffers[i].copy(out, offset);
            offset += buffers[i].length;
        }
        output(out);
    }

    // NB stack of buffers to write; e.g., first to write is at the
    // end.
    var buffers = [];
    var size = 0;
    var awaiting = 0;
    // Accumulator for buffer when we don't have enough to read a size.
    var sizebuf = new Buffer(4);
    var size_have = 0;

    // ------ states

    function report(state) {
        console.log(require('util').inspect(
            {
                state: state,
                buffers: buffers,
                size: size,
                awaiting: awaiting,
                sizebuf: sizebuf,
                size_have: size_have
            }));
    }

    function state_new(data) {
        var len = data.length;
        var bloblen = 0;

        if (len > 0) {
            bloblen = data[0];
            if (bloblen == 255) {
                if (len < 5) {
                    data.copy(sizebuf, 1);
                    size_have = len - 1;
                    state = state_more_size;
                }
                else {
                    size = awaiting = readsize(data, 1);
                    state = state_more;
                    state_more(data.slice(5));
                }
            }
            else {
                size = awaiting = bloblen;
                state = state_more;
                state_more(data.slice(1));
            }
        }
        /* else we got a zero-length buffer; just drop it (assumption:
         * this can happen) */
    }

    function state_more_size(data) {
        var len = data.length;
        if (size_have + len > 7) {
            // we could avoid this copy with more trickiness, but meh.
            data.copy(sizebuf, data, 0, size_have, 4 - size_have);
            size = awaiting = readsize(sizebuf);
            state = state_more;
            state_more(data.slice(size_have));
            // NB just leave size_have and sizebuf to be reinited by
            // state_new
        }
        else {
            data.copy(sizebuf, data, size_have);
            size_have += data.length;
            // state is already more_size
        }
    }

    function state_more(data) {
        if (data.length >= awaiting) {
            buffers.push(data.slice(0, awaiting));
            outputv(size, buffers);
            // assumption: better to reallocate this than to empty the
            // array
            buffers = [];
            state = state_new;
            state_new(data.slice(awaiting));
        }
        else {
            awaiting -= data.length;
            buffers.push(data);
        }
    }

    var state = state_new;

    underlying.on('data', function(d) { state(d) });
    underlying.on('end', end);
    underlying.on('drain', drain);
    underlying.on('error', error);
    underlying.on('close', close);

    this.readable = underlying.readable;
    this.writable = underlying.writable;
}

(function(proto) {

    proto.setEncoding = function(encoding) {
        this._encoding = encoding;
    };

    proto.pause = function() {
        this._underlying.pause();
    };

    proto.resume = function() {
        this._underlying.resume();
    };

    proto.destroy = function() {
        this.readable = this.writable = false;
        this._underlying.destroy();
    };

    proto.destroySoon = function() {
        this._underlying.destroySoon();
    };

    proto.write = function(data, encoding) {
        if (1 === arguments.length) {
            var len = data.length;
            // TODO see if reusing a buffer is faster
            if (len < 128) {
                var buf = new Buffer(len + 1);
                buf[0] = len;
                data.copy(buf, 1);
                this._underlying.write(buf);
            }
            else {
                var buf = new Buffer(len + 4);
                buf[0] = (len >>> 24);
                buf[1] = (len >>> 16) & 0xff;
                buf[2] = (len >>> 8) & 0xff;
                buf[3] = len & 0xff;
                data.copy(buf, 4);
                this._underlying.write(buf);
            }
        }
        else if (2 === arguments.length) {
            // TODO factor out to avoid alloc?
            this.write(new Buffer(data, encoding));
        }
    }

    BlobStream.prototype = proto;
})(new (require('stream'))());

module.exports.v32stream = function(underlying) {
    return new BlobStream(underlying);
};

// A wrapper around e.g., net.Server that will wrap incoming
// connections to be blob streams. Doesn't support the properties
// `connections` and `maxConnections`.

function BlobServer(server) {
    this._underlying = server;
    var that = this;
    server.on('connection', function(stream) {
        that.emit('connection', new BlobStream(stream));
    });
    server.on('close', function() { that.emit('close'); });
    server.on('listening', function() { that.emit('listening'); });
}

(function(proto) {
    proto.close = function() {
        return this._underlying.close();
    }

    BlobServer.prototype = proto;
})(new (require('events').EventEmitter)());

module.exports.v32server = function(underlying) {
    return new BlobServer(underlying);
};
