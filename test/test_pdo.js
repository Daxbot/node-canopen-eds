'use strict';

const chai   = require('chai');
const { getTxPdos, writePdoToObjects, addNewPdo, ObjectType, AccessType, DataType } = require('..');
const expect = chai.expect;

function sub(name, dataType, defaultValue, accessType = AccessType.READ_ONLY) {
    return { parameterName: name, objectType: ObjectType.VAR, dataType, accessType, defaultValue, pdoMapping: false };
}

/** A read-only TPDO 1 with three mapped objects, as a device file may define it. */
function buildObjects() {
    return {
        0x1800: {
            parameterName: 'TPDO communication parameter',
            objectType: ObjectType.RECORD,
            subObjects: {
                0: sub('max sub-index', DataType.UNSIGNED8, '6'),
                1: sub('COB-ID used by TPDO', DataType.UNSIGNED32, '0x387'),
                2: sub('transmission type', DataType.UNSIGNED8, '254'),
                3: sub('inhibit time', DataType.UNSIGNED16, '100'),
                4: sub('compatibility entry', DataType.UNSIGNED8, '0'),
                5: sub('event timer', DataType.UNSIGNED16, '0'),
                6: sub('SYNC start value', DataType.UNSIGNED8, '0'),
            },
        },
        0x1A00: {
            parameterName: 'TPDO mapping parameter',
            objectType: ObjectType.RECORD,
            subObjects: {
                0: sub('Number of mapped objects', DataType.UNSIGNED8, '3'),
                1: sub('Mapped object 1', DataType.UNSIGNED32, '0x21050008'),
                2: sub('Mapped object 2', DataType.UNSIGNED32, '0x20040008'),
                3: sub('Mapped object 3', DataType.UNSIGNED32, '0x20050008'),
            },
        },
    };
}

describe('getTxPdos', function () {
    it('reads a COB-ID with a $NODEID term', function () {
        const objects = buildObjects();
        objects[0x1800].subObjects[1].defaultValue = '$NODEID+0x180';
        expect(getTxPdos(objects)[0].cobId).to.equal(0x180);

        objects[0x1800].subObjects[1].defaultValue = '0x80000180 + $NODEID';
        const [pdo] = getTxPdos(objects);
        expect(pdo.cobId).to.equal(0x180);
        expect(pdo.disabled).to.equal(true);
    });

    it('reads hex values', function () {
        const objects = buildObjects();
        objects[0x1800].subObjects[3].defaultValue = '0x64';
        objects[0x1A00].subObjects[0].defaultValue = '0x03';
        const [pdo] = getTxPdos(objects);
        expect(pdo.inhibitTime).to.equal(100);
        expect(pdo.mappings).to.have.length(3);
    });

    it('uses the defaults for values it cannot read', function () {
        const objects = buildObjects();
        objects[0x1800].subObjects[1].defaultValue = '$NODEID+$NODEID';
        objects[0x1800].subObjects[2].defaultValue = 'junk';
        const [pdo] = getTxPdos(objects);
        expect(pdo.cobId).to.equal(0);
        expect(pdo.transmissionType).to.equal(254);
    });
});

describe('writePdoToObjects', function () {
    it('keeps an unchanged $NODEID COB-ID as it was', function () {
        const objects = buildObjects();
        objects[0x1800].subObjects[1].defaultValue = '$NODEID+0x180';
        const [pdo] = getTxPdos(objects);
        const updated = writePdoToObjects(objects, pdo, false);
        expect(updated[0x1800].subObjects[1].defaultValue).to.equal('$NODEID+0x180');
    });

    it('keeps the $NODEID term when the COB-ID changes', function () {
        const objects = buildObjects();
        objects[0x1800].subObjects[1].defaultValue = '$NODEID+0x180';
        const [pdo] = getTxPdos(objects);
        const updated = writePdoToObjects(objects, { ...pdo, disabled: true }, false);
        expect(updated[0x1800].subObjects[1].defaultValue).to.equal('$NODEID+0x80000180');
    });

    it('leaves an unchanged PDO as it was', function () {
        const objects = buildObjects();
        const [pdo] = getTxPdos(objects);
        const updated = writePdoToObjects(objects, pdo, false);
        expect(updated).to.deep.equal(objects);
    });

    it('keeps the names and access types of existing sub-objects', function () {
        const objects = buildObjects();
        const [pdo] = getTxPdos(objects);
        pdo.inhibitTime = 50;
        pdo.mappings.push({ index: 0x2008, subIndex: 0, bits: 8 });
        const updated = writePdoToObjects(objects, pdo, false);

        const comm = updated[0x1800].subObjects;
        expect(comm[3].parameterName).to.equal('inhibit time');
        expect(comm[3].accessType).to.equal(AccessType.READ_ONLY);
        expect(comm[3].defaultValue).to.equal('50');

        const map = updated[0x1A00].subObjects;
        expect(Object.keys(map)).to.have.length(5);
        expect(map[0].parameterName).to.equal('Number of mapped objects');
        expect(map[0].accessType).to.equal(AccessType.READ_ONLY);
        expect(map[0].defaultValue).to.equal('4');
        expect(map[1].accessType).to.equal(AccessType.READ_ONLY);
        expect(map[4].defaultValue).to.equal('0x20080008');
    });

    it('does not add default sub-objects to a short record', function () {
        const objects = buildObjects();
        for (const s of [3, 4, 5, 6]) {
            delete objects[0x1800].subObjects[s];
        }
        objects[0x1800].subObjects[0].defaultValue = '2';
        const [pdo] = getTxPdos(objects);
        expect(writePdoToObjects(objects, pdo, false)).to.deep.equal(objects);

        const updated = writePdoToObjects(objects, { ...pdo, eventTimer: 500 }, false);
        const comm = updated[0x1800].subObjects;
        expect(Object.keys(comm)).to.deep.equal(['0', '1', '2', '5']);
        expect(comm[5].defaultValue).to.equal('500');
        expect(comm[0].defaultValue).to.equal('0x05');
        expect(comm[0].parameterName).to.equal('max sub-index');
    });

    it('does not lower the declared highest sub-index', function () {
        const objects = buildObjects();
        for (const s of [3, 4, 5, 6]) {
            delete objects[0x1800].subObjects[s];
        }
        const [pdo] = getTxPdos(objects);
        const updated = writePdoToObjects(objects, { ...pdo, inhibitTime: 10 }, false);
        expect(updated[0x1800].subObjects[0].defaultValue).to.equal('6');
    });

    it('sets and clears the valid bit of the COB-ID', function () {
        const objects = buildObjects();
        const [pdo] = getTxPdos(objects);

        const disabled = writePdoToObjects(objects, { ...pdo, disabled: true }, false);
        expect(disabled[0x1800].subObjects[1].defaultValue).to.equal('0x80000387');
        expect(getTxPdos(disabled)[0].disabled).to.equal(true);

        const enabled = writePdoToObjects(disabled, { ...pdo, disabled: false }, false);
        expect(enabled[0x1800].subObjects[1].defaultValue).to.equal('0x00000387');
    });

    it('keeps bits 29 and 30 of the COB-ID', function () {
        const objects = buildObjects();
        objects[0x1800].subObjects[1].defaultValue = '0x40000387';
        const [pdo] = getTxPdos(objects);
        pdo.cobId = 0x388;
        const updated = writePdoToObjects(objects, pdo, false);
        expect(updated[0x1800].subObjects[1].defaultValue).to.equal('0x40000388');
    });

    it('gives a new PDO the read-write template with 8 slots', function () {
        const updated = addNewPdo({}, false);
        const map = updated[0x1A00].subObjects;
        expect(Object.keys(map)).to.have.length(9);
        expect(map[8].parameterName).to.equal('8th mapped object');
        expect(map[1].accessType).to.equal(AccessType.READ_WRITE);
        expect(updated[0x1800].subObjects[1].defaultValue).to.equal('0x00000181');
    });
});
