var assert = require('assert');
var spb = require('../lib/spb');

function partitions(arr) {

    var result = [[arr]];
    for (var i = 1; i < arr.length; i++) {
        var prefix = arr.slice(0, i);
        var subs = partitions(arr.slice(i))
        for (var j = 0; j < subs.length; j++) {
            var sub = subs[j].slice();
            sub.unshift(prefix);
            result.push(sub.slice());
        }
    }
    return result;
}

function part(inputs, expected) {
    var outputs = [];
    var instream = new (require('events').EventEmitter)();
    var outstream = spb.v32stream(instream);
    outstream.on('data', function(d) {outputs.push(d.toString());});
    for (var i = 0; i < inputs.length; i++) {
        instream.emit('data', new Buffer(inputs[i]));
    }
    assert.deepEqual(expected, outputs);
}

function parts(input, expected) {
    return test(expected, function() {
        var ps = [[input]];
        for (var i = 0; i < ps.length; i++) {
            part(ps[i], expected);
        }
    });
}

function TestStream() {
    this._paused = false;
    this._buffer = [];
}
(function(proto) {
    TestStream.prototype = proto;
    proto.write = function(data) {
        if (this._paused) {
            this._buffer.push(data);
        }
        else {
            this.emit('data', data);
        }
    };
    proto.pause = function() {
        this._paused = true;
    };
    proto.resume = function() {
        var that = this;
        this._paused = false;
        this._buffer.forEach(function(data) { that.emit('data', data); });
        this._buffer = [];
        this.emit('drain');
    };
})(new (require('stream').Stream)());

suite("#readsize", function() {
    function s(bytes, expected) {
        return test(bytes.toString() + " -> " + expected,
                    function() {
                        assert.equal(expected,
                                     spb.readsize(new Buffer(bytes)));
                    });
    }
    s([0, 0, 0, 1], 1);
    s([1, 0, 0, 0], Math.pow(2, 24));
    // would be negative for 32-bit twos complement integers
    s([128, 0, 0, 0], Math.pow(2, 31));
    s([255, 255, 255, 255], Math.pow(2, 32) - 1);
});

suite("parsing", function() {
    parts([], []);
    parts([0], [""]);
    parts([1, 65], ["A"]);

    parts([1, 65, 1, 66], ["A", "B"]);

    parts([2, 65, 66], ["AB"]);
    parts([3, 65, 66], []);
    parts([255, 0, 0, 0, 1, 65], ["A"]);
});

function encoded(encoding, bytes, expected) {
    return test(expected + '(' + encoding + ')',
                function() {
                    var ee = new (require('events').EventEmitter)();
                    var s = spb.v32stream(ee);
                    s.setEncoding(encoding);
                    var out = null;
                    s.on('data', function(d) { out = d; });
                    var b = bytes.slice();
                    b.unshift(b.length);
                    ee.emit('data', new Buffer(b));
                    assert.ok(typeof out === 'string');
                    assert.equal(expected, out);
                });
}

function write(name, indata) {
    return test(name, function() {
        var out = new TestStream();
        var outbuf = null;
        out.on('data', function(data) { outbuf = data; });
        var s = spb.v32stream(out);
        s.write(new Buffer(indata));
        assert.ok(outbuf);
        // NB use ascii only
        if (indata.length < 128) {
            assert.equal(indata.length, outbuf[0]);
            assert.equal(indata, outbuf.slice(1).toString());
        }
        else {
            assert.equal(indata.length, spb.readsize(outbuf));
            assert.equal(indata.toString(), outbuf.slice(4).toString());
        }
    });
}

suite("Stream", function() {

    suite("#setEncoding", function() {
        encoded("ascii", [0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], "foobar");
        // FIXME is this testing anything?
        encoded("utf8", [0xc2, 0xbd, 0x20, 0x2b, 0x20,
                         0xc2, 0xbc, 0x20, 0x3d, 0x20, 0xc2, 0xbe],
            "\u00bd + \u00bc = \u00be");
        encoded("base64", [0xc2, 0xbd, 0x20, 0x2b, 0x20,
                           0xc2, 0xbc, 0x20, 0x3d, 0x20, 0xc2, 0xbe],
                "wr0gKyDCvCA9IMK+");
    });

    suite("#write", function() {
        write("zero message", "");
        write("short data", "foobar");
        var small = new Buffer(128);
        small.fill('b');
        write("data on cusp of long", small);
        var longer = new Buffer(1024);
        longer.fill('a');
        write("longer data", longer);
        // just enough to touch the most significant byte in the
        // length
        var longest = new Buffer(Math.pow(2, 25) - 1);
        longest.fill('g');
        write("longest data", longest);
    });

    suite("#pause", function() {
        test("stops output until resume called",
             function() {
                 var input = new TestStream();
                 var out = [];
                 var s = spb.v32stream(input);
                 s.on('data', function(data) { out.push(data.toString()); });
                 s.resume();
                 assert.deepEqual([], out);
                 input.write(new Buffer([6]));
                 input.write(new Buffer("foobar"));
                 input.write(new Buffer([3]));
                 s.pause();
                 input.write(new Buffer("baz"));
                 assert.deepEqual(["foobar"], out);
                 var drainFired = false;
                 s.on('drain', function() { drainFired = true; });
                 s.resume();
                 assert.deepEqual(["foobar", "baz"], out);
                 assert.ok(drainFired);
             });
    });
});

suite("Server", function() {
    var net = require('net');
    var port = 56789;

    test("relays listen and close events", function(done) {
        var server = net.createServer();
        var bound = false;
        var blobserver = spb.v32server(server);
        blobserver.on('listening', function() { bound = true; server.close();});
        // NB a failure here entails the test case timing out
        blobserver.on('close', function() { done(); });
        server.listen(port);
    });

    test("wraps connections", function() {
        var server = net.createServer();
        var blobserver = spb.v32server(server);
        blobserver.on('connection', function(stream) {
            stream.on('data', function(data) {
                assert.equal("foobar", data);
                blobserver.close();
                done();
            });
        });
        server.listen(port);
        var sock = net.connect(port);
        sock.on('connect', function() {
            sock.write(new Buffer([6]));
            sock.write(new Buffer("foobar"));
            sock.end();
        });
    });
});
