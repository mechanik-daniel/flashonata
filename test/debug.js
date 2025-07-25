/* eslint-disable no-console */
/* eslint-disable strict */
import fs from 'fs';
import path from 'path';
import fumifier from '../src/fumifier.js';
import { FhirSnapshotGenerator } from 'fhir-snapshot-generator';
import { FhirStructureNavigator } from '@outburn/structure-navigator';

var context = ['il.core.fhir.r4#0.17.0'];

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

  var generator = await FhirSnapshotGenerator.create({
    context,
    cachePath: './test/.test-cache',
    fhirVersion: '4.0.1',
    cacheMode: 'lazy'
  });

  var navigator = new FhirStructureNavigator(generator);

  var expression = `
// a.b.(%.z)
// InstanceOf: Basic
// * (a.b).id = %.z
// a.b.{
//   "children": [
//   ($.%.z).{
//       'name': 'id',
//       'value': $
//     }
//   ]
// }

// Instance: 'abc_123'
// InstanceOf: bp
// * (input1).status = 'final'
// * (dob).birthDate.value = $
// * extension[ext-immigration].extension[origin].value.text = 'HMO Name'
// * active = true
// * (context1).name
//   * (context2).given = first_name
//   * family = last_name
// * generalPractitioner.reference = $literal('asas')
// * (context3).address.text = $
// * id
//   * value = '123'

// (a.b.c).(InstanceOf: Patient
// * (%).gender = %.z)

// (a.b.c).(%.%.z)







// InstanceOf: il-core-patient
// * gender = 'male'
// * identifier
//   * value = 'adafsd'
//   * system = 'http://example.com/identifier-system'
// * name
//   * given = 'John'
//   * family = 'Doe'
// * birthDate = '1980-01-01'

// (InstanceOf: Patient
// * birthDate = $now()).birthDate.*.$length()


// * identifier[2 - 1].value = field1
// InstanceOf: SimpleQuantity
// * comparator = '>='
// Instance: $a:='abc'

// Instance: (a.b.c).(%.%.z)
// InstanceOf: Patient
// * (a.b
// .c).id = (%

// .%

// .z)
// * (a.b.c). 
// gender.value = %.%
//   .z
// $a := 'abc'
// * id = $a

// [(a.b.c).(%.%.z)]

// InstanceOf: Patient
// * address.period.start = '32423432'

// InstanceOf: Patient
// * identifier.assigner
//   * reference = {'field2': 'value2'}.field2
// * active = "false"

// InstanceOf: Extension
// * url = (['abc','def'])[1]
// * valueString = ('test_value' & '1')



// Instance: 'abc'
// InstanceOf: Patient
// $semivar := 'semival';
// * extension.url = 'asfvvf'
// * name.given = 'first_name'
//   $var := 'val'
// * birthDate.id = '123'

// InstanceOf: Binary
// * id = '12345'
// * contentType = 'application/fhir+json'

// InstanceOf: data-absent-reason
// * url = '1234'
// * value = 'test_value'

// InstanceOf: Count
// * (['1234','7']).system = $
// * id = '1234'


// Instance: ['abc-123','789']//[0]
// InstanceOf: il-core-patient
// InstanceOf: Patient
// * name = {'family': 'Doe', 'extra': 'e'}
//   * (['a', 'b', 'c']).given = $
//     * id = '12345' 
// * name.given = ['x', 'y', 'z']
//   * id = '12345'
// * identifier[il-id]
//   * value = '123456789'
// * identifier
//   * system = 'http://example.com/identifier-system'
//   * value = '987654321'
// * birthDate = '1980-01-01'
//   * id = 'birth-date-id'
// * active = true
// * gender = 'male'

// Instance: ''
// InstanceOf: ext-il-hmo
// * url
// * value.text = a.b.%.z

// a.b.c.($='1' ?: %.%.z)

InstanceOf: bp
// * extension[ext-il-hmo].extension
  // * value.text = a.b.%.z
  // * url = 'http://example.com/identifier-system'
  // * extension
    // * url = 'http://example.com/extension-url'
  `;

  var expr;
  try {
    expr = await fumifier(expression, { navigator });
  } catch (e) {
    console.error('Error compiling expression:', e);
    return;
  }
  // console.log('Expression compiled:', expr.toString());

  var res = await expr.evaluate({
    a: {
      b: {
        c: 'd'
      },
      z: 'sibling'
    }
  });
  // console.log('ast', JSON.stringify(await expr.ast(), null, 2));
  // write the ast to a file
  fs.writeFileSync(path.join('test', 'ast.json'), JSON.stringify(await expr.ast(), null, 2));

  console.log('Result', JSON.stringify(res, null, 2));

//   console.log(JSON.stringify(await navigator.getElement('string', 'value'), null, 2));
}();
