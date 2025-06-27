/* eslint-disable no-console */
/* eslint-disable strict */
var jsonata = require("./jsonata");

// const fumeUrl = new URL("https://server.develop.fume.health");
var provider = require("../test/conformanceProvider");
var getSnapshot = provider.getSnapshot;

var getElementDefinition = provider.getElementDefinition;

void async function () {
    // var expression = `
    // Instance: 'instance'
    // InstanceOf: il-core-patient

    // * identifier[il-id]
    //   * system = c
    // //    * extension
    // //      * url = 'aaa'
    // //  * value
    // //    * id = 'iii'
    // //* active = true
    // //$a := $b
    // // * s = t = u
    // //* (d).\`multipleBirth[x]\`
    // // * (f).g = h
    // // * (i).j.k[0]
    // // * (i).j.k[0] = lmnop
    // // * (l).m.n[o] = p
    // // * (v).s = t = u
    // // * (context).flash.path = exprLeft = (exprRight + 1)
    // `;

    // var expression = "Instance: 'abc'\r\nInstanceOf: Patient\r\n* active = status='active'\r\n* name\r\n  * given = first_name\r\n  * family = last_name\r\n  * period\r\n    * start = '2000-01-01'\r\n* birthDate = birth_date\r\n* generalPractitioner\r\n  * identifier\r\n    * assigner\r\n      * identifier\r\n        * assigner\r\n          * identifier\r\n            * assigner\r\n              * reference = 'Organization/123'\r\n  * display = primary_doctor.full_name";
    // var expression = "InstanceOf: Patient\n$a:=1\n* (somecontext).element = some_value\n  * c";
    // var expression = "name";
    // var expression = "Instance: 'abc'\r\nInstanceOf: Patient\r\n* active = status='active'\r\n* name\r\n  * given = first_name\r\n  * family = last_name\r\n  * period\r\n    * start = '2000-01-01'\r\n* birthDate = birth_date\r\n* generalPractitioner\r\n  * identifier\r\n    * assigner\r\n      * identifier\r\n        * assigner\r\n          * identifier\r\n            * assigner\r\n              * reference = 'Organization/123'\r\n  * display = primary_doctor.full_name";
    // var expression = "Instance: 'abc'\r\nInstanceOf: Patient\r\n* active = status='active'\r\n* birthDate";
    // var expression = `
    // InstanceOf: il-core-patient
    // * identifier[il-id].system.extension.url = 'aaa'
    //   $var := 123
    // // {
    // //  'a': 1 + 2,
    // //  'b': $c
    // // }
    // `;


    var expression = "InstanceOf: il-core-patient\r\n* identifier[il-id].value = a";
    var expr = await jsonata(expression, {
        getSnapshot, getElementDefinition
    });
    var res = await expr.evaluate({a: 123});
    console.log('ast', JSON.stringify(await expr.ast(), null, 2));
    console.log('Result', res);
}();
