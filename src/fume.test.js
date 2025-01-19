/* eslint-disable no-console */
/* eslint-disable strict */
var jsonata = require("./jsonata");

void async function () {
    // var expr = jsonata(`
    // Instance: 'instance'
    // InstanceOf: il-core.patient_1

    // * q
    //   * b = c
    //     * a
    //       * b
    //   * z
    //     * y
    // * x
    // $a := $b
    // // * s = t = u
    // // * (d).e
    // // * (f).g = h
    // // * (i).j.k[0]
    // // * (i).j.k[0] = lmnop
    // // * (l).m.n[o] = p
    // // * (v).s = t = u
    // // * (context).flash.path = exprLeft = (exprRight + 1)
    // `, { recover: false });

    // var expression = "Instance: 'abc'\r\nInstanceOf: Patient\r\n* active = status='active'\r\n* name\r\n  * given = first_name\r\n  * family = last_name\r\n  * period\r\n    * start = '2000-01-01'\r\n* birthDate = birth_date\r\n* generalPractitioner\r\n  * identifier\r\n    * assigner\r\n      * identifier\r\n        * assigner\r\n          * identifier\r\n            * assigner\r\n              * reference = 'Organization/123'\r\n  * display = primary_doctor.full_name";
    var expression = "InstanceOf: Patient\n$a";
    // var expression = "Instance: 'abc'\r\nInstanceOf: Patient\r\n* active = status='active'\r\n* name\r\n  * given = first_name\r\n  * family = last_name\r\n  * period\r\n    * start = '2000-01-01'\r\n* birthDate = birth_date\r\n* generalPractitioner\r\n  * identifier\r\n    * assigner\r\n      * identifier\r\n        * assigner\r\n          * identifier\r\n            * assigner\r\n              * reference = 'Organization/123'\r\n  * display = primary_doctor.full_name";
    // var expression = "Instance: 'abc'\r\nInstanceOf: Patient\r\n* active = status='active'\r\n* birthDate";
    // var expression = "Instance: 'abc'\r\nInstanceOf: Patient\r\n* active = status\r\n* birthDate";
    // var expression = `
    //     // Instance: 123
    //     InstanceOf:
    //     `;
    var expr = jsonata(expression);
    expr.evaluate(null, {a: 123}).then((res) => {
        console.log('Result', res);
        return;
    }).catch((err) => console.error(err));
    console.log('ast', JSON.stringify(expr.ast(), null, 2));
}();
