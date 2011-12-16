var assert = require('assert');

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
    var outstream = require('../lib/spb').variable32(instream);
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

suite("Read size", function() {
    function s(bytes, expected) {
        return test(bytes.toString() + " -> " + expected,
                    function() {
                        assert.equal(expected,
                                     require('../lib/spb')
                                     .readsize(new Buffer(bytes)));
                    });
    }
    s([0, 0, 0, 1], 1);
    s([1, 0, 0, 0], Math.pow(2, 24));
    // would be negative for 32-bit twos complement numbers
    s([128, 0, 0, 0], Math.pow(2, 31));
    s([255, 255, 255, 255], Math.pow(2, 32) - 1);
});

suite("Variable 1 or 64 bit prefix", function() {
    parts([], []);
    parts([0], [""]);
    parts([1, 65], ["A"]);

    parts([1, 65, 1, 66], ["A", "B"]);

    parts([2, 65, 66], ["AB"]);
    parts([3, 65, 66], []);
    parts([255, 0, 0, 0, 1, 65], ["A"]);
});
