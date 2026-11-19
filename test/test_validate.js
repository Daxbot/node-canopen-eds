'use strict';

const chai = require('chai');
const fs = require('fs');
const path = require('path');
const {
    validateEds,
    parseEds,
    createEmptyEds,
    createVarEntry,
    createArrayEntry,
    createSubEntry,
    getTxPdos,
    writePdoToObjects,
    DataType,
    AccessType,
} = require('..');
const expect = chai.expect;

/**
 * Return the error and warning messages for a model.
 * @param {object} model
 * @returns {{errors: string[], warnings: string[]}}
 */
function check(model) {
    const findings = validateEds(model);
    return {
        errors: findings.filter(f => f.severity === 'error').map(f => f.message),
        warnings: findings.filter(f => f.severity === 'warning').map(f => f.message),
    };
}

/**
 * Return the DS301 template with a mappable UNSIGNED16 at 0x2000.
 * @returns {object}
 */
function baseModel() {
    const model = createEmptyEds('Test');
    model.objects[0x2000] = {
        ...createVarEntry('Value'),
        dataType: DataType.UNSIGNED16,
        accessType: AccessType.READ_WRITE,
        defaultValue: '0',
        pdoMapping: true,
    };
    return model;
}

/**
 * Map objects into TPDO 1 of a model.
 * @param {object} model
 * @param {Array<{index: number, subIndex: number, bits: number}>} mappings
 */
function mapTpdo1(model, mappings) {
    const [pdo] = getTxPdos(model.objects);
    model.objects = writePdoToObjects(model.objects, { ...pdo, mappings }, false);
}

describe('validateEds', function () {
    it('accepts the DS301 template', function () {
        expect(validateEds(createEmptyEds('Test'))).to.deep.equal([]);
    });

    it('accepts powernode.eds', function () {
        const text = fs.readFileSync(path.join(__dirname, '..', 'powernode.eds'), 'utf8');
        expect(check(parseEds(text)).errors).to.deep.equal([]);
    });

    it('finds a missing mandatory object', function () {
        const model = baseModel();
        delete model.objects[0x1018];
        expect(check(model).errors).to.include('Mandatory object Identity is missing');
    });

    it('finds a missing sub-index 0', function () {
        const model = baseModel();
        model.objects[0x2100] = createArrayEntry('Array');
        delete model.objects[0x2100].subObjects[0];
        expect(check(model).errors).to.include('Sub-index 0 is missing');
    });

    it('finds a sub-index 0 less than the highest sub-index', function () {
        const model = baseModel();
        model.objects[0x2100] = createArrayEntry('Array');
        const subs = model.objects[0x2100].subObjects;
        subs[5] = createSubEntry('Five');
        subs[0].defaultValue = '1';
        expect(check(model).errors.join()).to.contain('highest sub-index is 5');
    });

    it('lets sub-index 0 of a PDO mapping be a count', function () {
        const model = baseModel();
        mapTpdo1(model, [{ index: 0x2000, subIndex: 0, bits: 16 }]);
        expect(check(model).errors).to.deep.equal([]);
    });

    it('finds ARRAY sub-objects with different data types', function () {
        const model = baseModel();
        model.objects[0x2100] = createArrayEntry('Array');
        const subs = model.objects[0x2100].subObjects;
        subs[1] = createSubEntry('One');
        subs[2] = { ...createSubEntry('Two'), dataType: DataType.INTEGER32 };
        subs[0].defaultValue = '2';
        expect(check(model).errors.join()).to.contain('one data type');
    });

    it('finds an unknown access type', function () {
        const model = baseModel();
        model.objects[0x2000].accessType = 'rx';
        expect(check(model).errors).to.include("Unknown access type 'rx'");
    });

    it('finds a default value outside the data type', function () {
        const model = baseModel();
        model.objects[0x2000].defaultValue = '70000';
        expect(check(model).errors.join()).to.contain('outside the range');

        model.objects[0x2000].defaultValue = 'abc';
        expect(check(model).errors.join()).to.contain('not an integer');
    });

    it('accepts $NODEID, hex, and negative values', function () {
        const model = baseModel();
        model.objects[0x2000].defaultValue = '$NODEID+0x180';
        expect(check(model).errors).to.deep.equal([]);

        model.objects[0x2000].dataType = DataType.INTEGER16;
        model.objects[0x2000].defaultValue = '-5';
        expect(check(model).errors).to.deep.equal([]);

        model.objects[0x2000].defaultValue = '0xFFFF';
        expect(check(model).errors).to.deep.equal([]);
    });

    it('checks 64-bit values without loss of precision', function () {
        const model = baseModel();
        model.objects[0x2000].dataType = DataType.UNSIGNED64;
        model.objects[0x2000].defaultValue = '0xFFFFFFFFFFFFFFFF';
        expect(check(model).errors).to.deep.equal([]);

        model.objects[0x2000].defaultValue = '0x10000000000000000';
        expect(check(model).errors.join()).to.contain('outside the range');
    });

    it('finds a default value outside the limits', function () {
        const model = baseModel();
        Object.assign(model.objects[0x2000], { lowLimit: '10', highLimit: '20', defaultValue: '30' });
        expect(check(model).errors.join()).to.contain('greater than highLimit');

        Object.assign(model.objects[0x2000], { lowLimit: '30', defaultValue: '25' });
        expect(check(model).errors.join()).to.contain('lowLimit 30 is greater than highLimit 20');
    });

    it('finds a PDO that maps an object that does not exist', function () {
        const model = baseModel();
        mapTpdo1(model, [{ index: 0x2999, subIndex: 0, bits: 16 }]);
        expect(check(model).errors.join()).to.contain('does not exist');
    });

    it('finds a PDO that maps an object with PDOMapping=0', function () {
        const model = baseModel();
        model.objects[0x2000].pdoMapping = false;
        mapTpdo1(model, [{ index: 0x2000, subIndex: 0, bits: 16 }]);
        expect(check(model).errors.join()).to.contain('PDOMapping=0');
    });

    it('finds a PDO with more than 64 bits', function () {
        const model = baseModel();
        const m = { index: 0x2000, subIndex: 0, bits: 16 };
        mapTpdo1(model, [m, m, m, m, m]);
        expect(check(model).errors.join()).to.contain('80 bits');
    });

    it('warns when the mapped length is not the data type length', function () {
        const model = baseModel();
        mapTpdo1(model, [{ index: 0x2000, subIndex: 0, bits: 8 }]);
        expect(check(model).warnings.join()).to.contain('maps 8 bits');
    });

    it('finds a dummy entry in a TPDO', function () {
        const model = baseModel();
        mapTpdo1(model, [{ index: DataType.UNSIGNED8, subIndex: 0, bits: 8 }]);
        expect(check(model).errors.join()).to.contain('only an RPDO can map');
    });

    it('finds two enabled PDOs with one COB-ID', function () {
        const model = baseModel();
        const [pdo1, pdo2] = getTxPdos(model.objects);
        model.objects = writePdoToObjects(model.objects, { ...pdo1, disabled: false }, false);
        model.objects = writePdoToObjects(model.objects, { ...pdo2, cobId: pdo1.cobId, disabled: false }, false);
        expect(check(model).errors.join()).to.contain('same COB-ID as TPDO 1');

        model.objects = writePdoToObjects(model.objects, { ...pdo2, cobId: pdo1.cobId, disabled: true }, false);
        expect(check(model).errors).to.deep.equal([]);
    });
});
