# Size-prefixed blob streams

It is often useful to treat a continuous byte stream as a series of
discrete messages. This library gives you a simple but effective way
to do this, by prefacing each message with the size of the message. In
other words, it saves you writing a bit of fiddly parsing code if you
just want to deal with whole things (e.g., JSON objects) at a time.

You can wrap streams (e.g., `net.Socket`) or things that look like
`net.Server`. If you wrap a stream, then it treats incoming data as
size-prefix encoded and hands you each message (without the size
prefix) as a `'data'` event; if you write a string or buffer, it
treats it as a message and encode it with a size prefix. If you wrap a
server, it provides wrapped streams in the `'connection'` event.

## Trivial example

    > var netserver = require('net').createServer();
    > var msgserver = require('spb').server(netserver);
    > msgserver.on('connection', function(connection) {
    ... connection.on('data', function(message) {
    ...... // do something with the whole message
    ...... });
    ... });
    > netserver.listen(5975);

## Reference

### **`spb.stream(underlying)`**

Wraps a [Stream](http://nodejs.org/docs/latest/api/streams.html).

The returned stream shall parse bytes from the underlying stream and
emit `'data'` events consisting of whole messages (without the length
prefix). Buffers or strings written to the returned stream shall be
encoded with a size-prefix and written to the underlying stream.

The wrapped stream relays events (`'drain'`, `'error'`, `'end'`,
`'pipe'`) from the underlying stream. Aside from `'data'` it is
equivalent to give a callback to either the underlying stream or the
wrapped stream.

Likewise, the methods `pause`, `resume`, `destroy`, and `destroySoon`
for the wrapped stream simply invoke the same on the underlying
stream. It is not in general safe to invoke either `write` or
`setEncoding` on the underlying stream, as these interfere with the
size prefixing. `setEncoding` on the wrapped stream does the 'right
thing', in other words, it results in the messages emitted being
strings.

### **`spb.server(underlying)`**

Wraps a server, providing connections that are wrapped streams.

The underlying server must look like a `net.Server`. Specifically, it
must emit the `'listening'`, `'close'` and `'connection'` events, and
have a `close` method. It is safe to invoke methods and to supply
callbacks for the above events on the underlying server; only
`'connection'` is not equivalent.

## A note on pipes

Piping a spb stream to a byte stream will simply strip out size
prefixes, effectively concatenating the messages into undelimited
bytes. Piping a byte stream to a spb stream will encode as discrete
messages the (probably arbitrarily delimited) packets read on the byte
stream.
