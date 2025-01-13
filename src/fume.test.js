/* eslint-disable no-console */
/* eslint-disable strict */
var jsonata = require("./jsonata");

void async function () {
    // var expr = jsonata(`(//Instance: a + b.c.(d)
    //     // Instance: patient
    //     InstanceOf: il-core.patient_1

    //     // * q[r]
    //     * b = c
    //     // $a := $b;
    //     // * s = t = u
    //     // * (d).e
    //     * (f).g = h
    //     // * (i).j.k[0]
    //     // * (i).j.k[0] = lmnop
    //     // * (l).m.n[o] = p
    //     // * (v).s = t = u
    //     // * (context).flash.path = exprLeft = (exprRight + 1)
    //     )`, { recover: false });

    var expr = jsonata(`

    (Instance: $a
      InstanceOf: http://jdjdjd
        *(context).path.path2=(3*
            3)
        // $expression := (
           )       // bc
        // - 1)
        `, { recover: false });
    expr.evaluate(null).then((res) => {
        console.log('Result', res);
        return;
    }).catch((err) => console.error(err));
    console.log('ast', JSON.stringify(expr.ast(), null, 2));
}();
