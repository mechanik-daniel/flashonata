/* eslint-disable valid-jsdoc */
/* eslint-disable no-prototype-builtins */
/**
 * © Copyright IBM Corp. 2016 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 */

import fs from "fs";
import path from "path";
import fumifier from "../src/fumifier.js";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { FhirStructureNavigator } from "@outburn/structure-navigator";
import { FhirSnapshotGenerator } from "fhir-snapshot-generator";
import { fileURLToPath } from 'url';

chai.use(chaiAsPromised);
const expect = chai.expect;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const context = ['il.core.fhir.r4#0.17.0'];

const groups = fs
    .readdirSync(path.join(__dirname, "test-suite", "groups"))
    .filter((name) => !name.endsWith(".json"));

const datasets = {};
const datasetnames = fs.readdirSync(path.join(__dirname, "test-suite", "datasets"));

datasetnames.forEach((name) => {
    datasets[name.replace(".json", "")] = readJSON(path.join("test-suite", "datasets"), name);
});

describe("JSONata Test Suite", () => {
    let fsg;
    let navigator;

    before(async () => {
        fsg = await FhirSnapshotGenerator.create({
            context,
            cachePath: './test/.test-cache',
            fhirVersion: '4.0.1',
            cacheMode: 'lazy'
        });
        navigator = new FhirStructureNavigator(fsg);
    });

    groups.forEach(group => {
        const filenames = fs
            .readdirSync(path.join(__dirname, "test-suite", "groups", group))
            .filter((name) => name.endsWith(".json"));

        let cases = [];
        filenames.forEach(name => {
            const spec = readJSON(path.join("test-suite", "groups", group), name);
            if (Array.isArray(spec)) {
                spec.forEach(item => {
                    if (!item.description) {
                        item.description = name;
                    }
                });
                cases = cases.concat(spec);
            } else {
                if (!spec.description) {
                    spec.description = name;
                }
                cases.push(spec);
            }
        });

        describe("Group: " + group, () => {
            for (let i = 0; i < cases.length; i++) {
                const testcase = cases[i];

                if (testcase['expr-file']) {
                    testcase.expr = fs.readFileSync(
                        path.join(__dirname, "test-suite", "groups", group, testcase['expr-file'])
                    ).toString();
                }

                it(testcase.description + ": " + testcase.expr, async function () {
                    let expr;

                    try {
                        const maybePromise = fumifier(testcase.expr, { navigator });
                        expr = (maybePromise && typeof maybePromise.then === 'function') ?
                            await maybePromise :
                            maybePromise;

                        if ("timelimit" in testcase && "depth" in testcase) {
                            this.timeout(testcase.timelimit * 2);
                            timeboxExpression(expr, testcase.timelimit, testcase.depth);
                        }
                    } catch (e) {
                        if (testcase.code) {
                            const code = e?.code || (typeof e === 'object' ? e.code : undefined);
                            expect(code).to.equal(testcase.code);
                            if (testcase.hasOwnProperty("token")) {
                                expect(e.token).to.equal(testcase.token);
                            }
                            return;
                        } else {
                            throw new Error("Got an unexpected exception: " + (e?.message || e));
                        }
                    }

                    if (!expr) {
                        throw new Error("No expression was parsed");
                    }

                    const dataset = resolveDataset(datasets, testcase);

                    if ("undefinedResult" in testcase) {
                        const result = await expr.evaluate(dataset, testcase.bindings);
                        return expect(result).to.deep.equal(undefined);
                    } else if ("result" in testcase) {
                        const result = await expr.evaluate(dataset, testcase.bindings);
                        return expect(result).to.deep.equal(testcase.result);
                    } else if ("error" in testcase) {
                        try {
                            await expr.evaluate(dataset, testcase.bindings);
                            throw new Error("Expected evaluation to fail, but it succeeded.");
                        } catch (e) {
                            expect(e).to.deep.contain(testcase.error);
                        }
                    } else if ("code" in testcase) {
                        try {
                            await expr.evaluate(dataset, testcase.bindings);
                            throw new Error(`Expected evaluation to fail with code '${testcase.code}', but it succeeded.`);
                        } catch (e) {
                            const code = e?.code || (typeof e === 'object' ? e.code : undefined);
                            expect(code).to.equal(testcase.code);
                        }
                    } else {
                        throw new Error("Nothing to test in this test case");
                    }
                });
            }
        });
    });
});

/**
 * Reads and parses JSON from disk
 */
function readJSON(dir, file) {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, dir, file)).toString());
    } catch (e) {
        throw new Error("Error reading " + file + " in " + dir + ": " + e.message);
    }
}

/**
 * Protect the process/browser from a runaway expression
 */
function timeboxExpression(expr, timeout, maxDepth) {
    let depth = 0;
    const time = Date.now();

    const checkRunnaway = () => {
        if (maxDepth > 0 && depth > maxDepth) {
            throw {
                message: "Stack overflow error: Check for non-terminating recursive function.",
                stack: new Error().stack,
                code: "U1001"
            };
        }
        if (Date.now() - time > timeout) {
            throw {
                message: "Expression evaluation timeout: Check for infinite loop",
                stack: new Error().stack,
                code: "U1001"
            };
        }
    };

    expr.assign(Symbol.for('fumifier.__evaluate_entry'), (expr, input, env) => {
        if (env.isParallelCall) return;
        depth++;
        checkRunnaway();
    });
    expr.assign(Symbol.for('fumifier.__evaluate_exit'), (expr, input, env) => {
        if (env.isParallelCall) return;
        depth--;
        checkRunnaway();
    });
}

/**
 * Determines what input data to use in the test case
 */
function resolveDataset(datasets, testcase) {
    if ("data" in testcase) {
        return testcase.data;
    }
    if (testcase.dataset === null) {
        return undefined;
    }
    if (datasets.hasOwnProperty(testcase.dataset)) {
        return datasets[testcase.dataset];
    }
    throw new Error("Unable to find dataset " + testcase.dataset +
        " among known datasets, are you sure the datasets directory has a file named " +
        testcase.dataset + ".json?");
}
