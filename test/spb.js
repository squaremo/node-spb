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

suite("Read size", function() {
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

suite("Parsing of stream", function() {
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

suite("setEncoding results in suitably encoded strings", function() {
    encoded("ascii", [0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72], "foobar");
    // FIXME is this testing anything?
    encoded("utf8", [0xc2, 0xbd, 0x20, 0x2b, 0x20,
                     0xc2, 0xbc, 0x20, 0x3d, 0x20, 0xc2, 0xbe],
            "\u00bd + \u00bc = \u00be");
    encoded("base64", [0xc2, 0xbd, 0x20, 0x2b, 0x20,
                       0xc2, 0xbc, 0x20, 0x3d, 0x20, 0xc2, 0xbe],
            "wr0gKyDCvCA9IMK+");
});

suite("Pause, resume", function() {
    test("Pause a stream and get no results until resumed",
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
