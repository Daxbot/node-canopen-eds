/**
 * @file CANopenNode V4 exporter implementation
 * @author Wilkins White
 * @copyright 2024 Daxbot
 *
 * Exports EDS object to CANopenNode V4 compatible OD.c and OD.h files
 */

const { ObjectType, DataType } = require('../types');

/**
 * Convert parameter name to valid C identifier
 * @param {string} name - parameter name
 * @returns {string} C-valid identifier
 * @private
 */
function makeCName(name) {
    if (!name) {
        return '';
    }

    const tokens = name
        .replace(/-/g, '_')
        .split(/[\W]+/)
        .filter(s => s !== '');

    let output = '';
    let prevChar = ' ';

    for (const tok of tokens) {
        const firstChar = tok[0];

        if (firstChar && /[A-Z]/.test(firstChar) &&
            prevChar && /[A-Z]/.test(prevChar)) {
            output += '_';
        }


        if (tok.length > 1 && /[a-zA-Z]/.test(firstChar)) {
            output += firstChar.toUpperCase() + tok.substring(1);
        } else {
            output += tok;
        }


        prevChar = tok[tok.length - 1];
    }

    if (/[0-9]/.test(output[0])) {
        output = '_' + output;
    } else if (output.length > 1) {
        if (/[a-zA-Z]/.test(output[0]) && /[a-z]/.test(output[1])) {
            output = output[0].toLowerCase() + output.substring(1);
        }

    } else if (output.length === 1) {
        output = output.toLowerCase();
    }

    return output;
}

/**
 * Get C data type properties from CANopen data type
 * @param {DataType} dataType - CANopen data type
 * @param {*} defaultValue - default value
 * @param {number} stringLength - string length for string types
 * @param {string} indexH - index in hex for error reporting
 * @returns {object} data properties
 * @private
 */
function getDataProperties(dataType, defaultValue, stringLength, indexH) {
    const props = {
        cType: 'not specified',
        cTypeArray: '',
        cTypeArray0: '',
        cTypeMultibyte: false,
        cTypeString: false,
        length: 0,
        cValue: null
    };

    let valueDefined = defaultValue !== undefined && defaultValue !== null && defaultValue !== '';
    let nobase = 10;

    if (valueDefined && ![
        DataType.VISIBLE_STRING,
        DataType.UNICODE_STRING,
        DataType.OCTET_STRING
    ].includes(dataType)) {
        const trimmed = String(defaultValue).trim();

        if (trimmed.toUpperCase().includes('$NODEID')) {
            const cleaned = trimmed.toUpperCase()
                .replace('$NODEID', '')
                .replace(/\+/g, '')
                .trim() || '0';
            defaultValue = cleaned;
        }

        if (/^0[xX][0-9a-fA-F]+[UL]*$/.test(trimmed)) {
            nobase = 16;
            defaultValue = trimmed.replace(/[UL]/g, '');
        } else if (/^0[0-7]+$/.test(trimmed)) {
            nobase = 8;
        }
    }

    try {
        switch (dataType) {
            case DataType.BOOLEAN:
                props.length = 1;
                props.cType = 'bool_t';
                if (valueDefined) {
                    props.cValue = (String(defaultValue).toLowerCase() === 'false' || defaultValue === 0) ? 'false' : 'true';
                }

                break;

            case DataType.INTEGER8:
                props.length = 1;
                props.cType = 'int8_t';
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.INTEGER16:
                props.length = 2;
                props.cType = 'int16_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.INTEGER32:
                props.length = 4;
                props.cType = 'int32_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.INTEGER64:
                props.length = 8;
                props.cType = 'int64_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(parseInt(defaultValue, nobase));
                }

                break;

            case DataType.UNSIGNED8:
                props.length = 1;
                props.cType = 'uint8_t';
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(2, '0').toUpperCase();
                }

                break;

            case DataType.UNSIGNED16:
                props.length = 2;
                props.cType = 'uint16_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(4, '0').toUpperCase();
                }

                break;

            case DataType.UNSIGNED32:
                props.length = 4;
                props.cType = 'uint32_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(8, '0').toUpperCase();
                }

                break;

            case DataType.UNSIGNED64:
                props.length = 8;
                props.cType = 'uint64_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = '0x' + parseInt(defaultValue, nobase).toString(16).padStart(16, '0').toUpperCase();
                }

                break;

            case DataType.REAL32:
                props.length = 4;
                props.cType = 'float32_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(defaultValue);
                }

                break;

            case DataType.REAL64:
                props.length = 8;
                props.cType = 'float64_t';
                props.cTypeMultibyte = true;
                if (valueDefined) {
                    props.cValue = String(defaultValue);
                }

                break;

            case DataType.VISIBLE_STRING:
                props.cTypeString = true;
                if (valueDefined || stringLength > 0) {
                    const chars = [];
                    let len = 0;

                    if (valueDefined) {
                        const str = String(defaultValue);
                        for (const char of str) {
                            const code = char.charCodeAt(0);
                            if (char === "'") {
                                chars.push("'\\''");
                            } else if (code >= 0x20 && code < 0x7F) {
                                chars.push(`'${char}'`);
                            } else if (code <= 0x7F) {
                                chars.push(`0x${code.toString(16).padStart(2, '0')}`);
                            } else {
                                chars.push(`(char)0x${code.toString(16).padStart(2, '0')}`);
                            }

                            len++;
                        }
                    }

                    for (; len < stringLength; len++) {
                        chars.push('0');
                    }


                    chars.push('0');
                    props.length = len;
                    props.cType = 'char';
                    props.cTypeArray = `[${len + 1}]`;
                    props.cTypeArray0 = '[0]';
                    props.cValue = `{${chars.join(', ')}}`;
                }
                break;

            case DataType.DOMAIN:
                break;

            case DataType.INTEGER24:
            case DataType.INTEGER40:
            case DataType.INTEGER48:
            case DataType.INTEGER56:
                if (dataType === DataType.INTEGER24) {
                    props.length = 3;
                } else if (dataType === DataType.INTEGER40) {
                    props.length = 5;
                } else if (dataType === DataType.INTEGER48) {
                    props.length = 6;
                } else {
                    props.length = 7;
                }
                if (valueDefined) {
                    const val = BigInt(parseInt(defaultValue, nobase));
                    const bytes = [];
                    for (let i = 0; i < props.length; i++) {
                        bytes.push('0x' + ((val >> BigInt(8 * i)) & BigInt(0xFF)).toString(16).padStart(2, '0').toUpperCase());
                    }

                    props.cType = 'uint8_t';
                    props.cTypeArray = `[${props.length}]`;
                    props.cTypeArray0 = '[0]';
                    props.cValue = `{${bytes.join(', ')}}`;
                }
                break;

            case DataType.UNSIGNED24:
            case DataType.UNSIGNED40:
            case DataType.UNSIGNED48:
            case DataType.UNSIGNED56:
            case DataType.TIME_OF_DAY:
            case DataType.TIME_DIFFERENCE:
                props.length = dataType === DataType.UNSIGNED24 ? 3 : dataType === DataType.UNSIGNED40 ? 5 : 6;
                if (valueDefined) {
                    const val = BigInt(parseInt(defaultValue, nobase));
                    const bytes = [];
                    for (let i = 0; i < props.length; i++) {
                        bytes.push('0x' + ((val >> BigInt(8 * i)) & BigInt(0xFF)).toString(16).padStart(2, '0').toUpperCase());
                    }

                    props.cType = 'uint8_t';
                    props.cTypeArray = `[${props.length}]`;
                    props.cTypeArray0 = '[0]';
                    props.cValue = `{${bytes.join(', ')}}`;
                }
                break;
        }
    } catch (error) {
        throw new Error(
            `Failed converting default value ${defaultValue} for OD index 0x${indexH} and data type ${dataType}`,
            { cause: error }
        );
    }

    return props;
}

/**
 * Get OD entry attributes based on access types and data properties
 * @param {DataObject} entry - OD entry
 * @param {boolean} cTypeMultibyte - is multibyte type
 * @param {boolean} cTypeString - is string type
 * @returns {string} attribute string
 * @private
 */
function getAttributes(entry, cTypeMultibyte, cTypeString) {
    const attributes = [];

    const accessType = entry.accessType || 'ro';
    if (accessType.includes('r') && accessType.includes('w')) {
        attributes.push('ODA_SDO_RW');
    } else if (accessType.includes('r')) {
        attributes.push('ODA_SDO_R');
    } else if (accessType.includes('w')) {
        attributes.push('ODA_SDO_W');
    }


    if (cTypeMultibyte) {
        attributes.push('ODA_MB');
    }


    if (cTypeString) {
        attributes.push('ODA_STR');
    }


    return attributes.length > 0 ? attributes.join(' | ') : '0';
}

/**
 * Prepare data structure from EDS for export
 * @param {Eds} eds - EDS object
 * @returns {object} prepared data
 * @private
 */
function prepareData(eds) {
    const ODCnt = {};
    const ODArrSize = {};
    const ODStorageGroups = [];
    const odStorageT = {};
    const ODStorage = {};
    const odObjsT = [];
    const ODObjs = [];
    const ODList = [];
    const ODDefines = [];
    const ODDefinesLong = [];

    const countLabels = {
        0x1000: 'NMT',
        0x1001: 'EM',
        0x1005: 'SYNC',
        0x1006: 'SYNC_PROD',
        0x1010: 'STORAGE',
        0x1012: 'TIME',
        0x1014: 'EM_PROD',
        0x1016: 'HB_CONS',
        0x1017: 'HB_PROD',
        0x1200: 'SDO_SRV',
        0x1280: 'SDO_CLI',
        0x1300: 'GFC',
        0x1301: 'SRDO',
        0x1400: 'RPDO',
        0x1800: 'TPDO'
    };

    const group = 'RAM';

    for (const [indexKey, entry] of Object.entries(eds._model.objects)) {
        const index = parseInt(indexKey, 10);
        const indexH = index.toString(16).padStart(4, '0').toUpperCase();
        const cName = makeCName(entry.parameterName);
        const varName = `${indexH}_${cName}`;

        if (!ODStorageGroups.includes(group)) {
            ODStorageGroups.push(group);
            odStorageT[group] = [];
            ODStorage[group] = [];
        }

        let objectType = '';
        let subEntriesCount = 0;

        // Build a flat array of sub-entries with subIndex attached.
        // subObjects keys are numeric and include sub-index 0 (max-sub-index).
        const subEntries = entry.objectType === ObjectType.VAR
            ? []
            : Object.entries(entry.subObjects || {})
                .map(([k, v]) => ({ ...v, subIndex: parseInt(k) }));

        if (subEntries.length === 0) {
            objectType = 'VAR';
            subEntriesCount = 1;

            const dataProps = getDataProperties(entry.dataType, entry.defaultValue, entry.stringLength, indexH);
            const attr = getAttributes(entry, dataProps.cTypeMultibyte, dataProps.cTypeString);

            odObjsT.push(`OD_obj_var_t o_${varName};`);
            ODObjs.push(`    .o_${varName} = {`);
            ODObjs.push(`        .dataOrig = NULL,`);
            ODObjs.push(`        .attribute = ${attr},`);
            ODObjs.push(`        .dataLength = ${dataProps.length}`);
            ODObjs.push(`    },`);
        } else if (entry.objectType === ObjectType.ARRAY) {
            objectType = 'ARR';
            subEntriesCount = subEntries.length;
            ODArrSize[indexH] = subEntriesCount - 1;

            if (subEntriesCount > 1) {
                // Sub-index 1 is the first data element; its type represents all elements.
                const firstDataSub = (entry.subObjects || {})[1] || subEntries[1];
                const dataProps = getDataProperties(
                    firstDataSub?.dataType || entry.dataType,
                    firstDataSub?.defaultValue,
                    firstDataSub?.stringLength,
                    indexH
                );
                const attr = getAttributes(firstDataSub, dataProps.cTypeMultibyte, dataProps.cTypeString);

                odObjsT.push(`OD_obj_array_t o_${varName};`);
                ODObjs.push(`    .o_${varName} = {`);
                ODObjs.push(`        .dataOrig0 = NULL,`);
                ODObjs.push(`        .dataOrig = NULL,`);
                ODObjs.push(`        .attribute0 = ${attr},`);
                ODObjs.push(`        .attribute = ${attr},`);
                ODObjs.push(`        .dataElementLength = ${dataProps.length},`);
                ODObjs.push(`        .dataElementSizeof = sizeof(${dataProps.cType}${dataProps.cTypeArray})`);
                ODObjs.push(`    },`);
            }
        } else if (entry.objectType === ObjectType.RECORD) {
            objectType = 'REC';
            subEntriesCount = subEntries.length;

            if (subEntriesCount > 1) {
                odObjsT.push(`OD_obj_record_t o_${varName}[${subEntriesCount}];`);
                ODObjs.push(`    .o_${varName} = {`);

                for (const sub of subEntries) {
                    const dataProps = getDataProperties(sub.dataType, sub.defaultValue, sub.stringLength, indexH);
                    const attr = getAttributes(sub, dataProps.cTypeMultibyte, dataProps.cTypeString);

                    ODObjs.push(`        {`);
                    ODObjs.push(`            .dataOrig = NULL,`);
                    ODObjs.push(`            .subIndex = ${sub.subIndex},`);
                    ODObjs.push(`            .attribute = ${attr},`);
                    ODObjs.push(`            .dataLength = ${dataProps.length}`);
                    ODObjs.push(`        },`);
                }

                const lastObj = ODObjs[ODObjs.length - 1];
                ODObjs[ODObjs.length - 1] = lastObj.slice(0, -1);
                ODObjs.push(`    },`);
            }
        }

        if (subEntriesCount > 0) {
            ODDefines.push(`#define OD_ENTRY_H${indexH} &OD->list[${ODList.length}]`);
            ODDefinesLong.push(`#define OD_ENTRY_H${varName} &OD->list[${ODList.length}]`);

            ODList.push(`{0x${indexH}, 0x${subEntriesCount.toString(16).padStart(2, '0')}, ODT_${objectType}, &ODObjs.o_${varName}, NULL}`);

            const countLabel = countLabels[index];
            if (countLabel) {
                ODCnt[countLabel] = (ODCnt[countLabel] || 0) + 1;
            }

        }
    }

    return {
        ODCnt,
        ODArrSize,
        ODStorageGroups,
        ODStorage_t: odStorageT,
        ODStorage,
        ODObjs_t: odObjsT,
        ODObjs,
        ODList,
        ODDefines,
        ODDefinesLong
    };
}

/**
 * Export EDS to CANopenNode OD.h and OD.c file contents.
 * @param {Eds} eds - EDS object to export
 * @param {string} [filename] - base filename (no extension) used in #include and guards
 * @returns {{ header: string, source: string }}
 */
function exportOD(eds, filename = 'OD') {
    const prepared = prepareData(eds);
    const odname = 'OD';

    return {
        header: exportODHeader(filename, odname, eds, prepared),
        source: exportODSource(filename, odname, prepared),
    };
}

/**
 * Build OD.h file content.
 * @param filename
 * @param odname
 * @param eds
 * @param prepared
 * @private
 * @returns {string}
 */
function exportODHeader(filename, odname, eds, prepared) {
    const lines = [];

    lines.push(`/*******************************************************************************
    CANopen Object Dictionary definition for CANopenNode V4

    This file was automatically generated by node-canopen

    https://github.com/CANopenNode/CANopenNode
    https://github.com/DaxBot/node-canopen

    DON'T EDIT THIS FILE MANUALLY !!!!
********************************************************************************

    File info:
        File Names:   ${filename}.h; ${filename}.c
        Project File: ${eds.fileName || 'unknown'}
        File Version: ${eds.fileVersion || 1}

        Created:      ${new Date().toLocaleString()}
        Created By:   node-canopen
        Modified:     ${new Date().toLocaleString()}
        Modified By:  node-canopen

    Device Info:
        Vendor Name:  ${eds.vendorName || ''}
        Vendor ID:    0x${(eds.vendorNumber || 0).toString(16)}
        Product Name: ${eds.productName || ''}
        Product ID:   ${eds.productNumber || ''}

        Description:  ${eds.description || ''}
*******************************************************************************/

#ifndef ${odname}_H
#define ${odname}_H
/*******************************************************************************
    Counters of OD objects
*******************************************************************************/`);

    for (const [key, value] of Object.entries(prepared.ODCnt)) {
        lines.push(`#define ${odname}_CNT_${key} ${value}`);
    }


    lines.push(`

/*******************************************************************************
    Sizes of OD arrays
*******************************************************************************/`);

    for (const [key, value] of Object.entries(prepared.ODArrSize)) {
        lines.push(`#define ${odname}_CNT_ARR_${key} ${value}`);
    }


    lines.push(`

/*******************************************************************************
    OD data declaration of all groups
*******************************************************************************/`);

    lines.push(`#ifndef ${odname}_ATTR_RAM
#define ${odname}_ATTR_RAM
#endif
extern ${odname}_ATTR_RAM ${odname}_RAM_t ${odname}_RAM;

#ifndef ${odname}_ATTR_OD
#define ${odname}_ATTR_OD
#endif
extern ${odname}_ATTR_OD OD_t *${odname};

/*******************************************************************************
    Object dictionary entries - shortcuts
*******************************************************************************/`);

    lines.push(prepared.ODDefines.join('\n'));

    lines.push(`

/*******************************************************************************
    Object dictionary entries - shortcuts with names
*******************************************************************************/`);

    lines.push(prepared.ODDefinesLong.join('\n'));

    lines.push(`
#endif /* ${odname}_H */`);

    return lines.join('\n') + '\n';
}

/**
 * Build OD.c file content.
 * @param filename
 * @param odname
 * @param prepared
 * @private
 * @returns {string}
 */
function exportODSource(filename, odname, prepared) {
    const lines = [];

    lines.push(`/*******************************************************************************
    CANopen Object Dictionary definition for CANopenNode V4

    This file was automatically generated by node-canopen

    https://github.com/CANopenNode/CANopenNode
    https://github.com/DaxBot/node-canopen

    DON'T EDIT THIS FILE MANUALLY, UNLESS YOU KNOW WHAT YOU ARE DOING !!!!
*******************************************************************************/

#define OD_DEFINITION
#include "301/CO_ODinterface.h"
#include "${filename}.h"

#if CO_VERSION_MAJOR < 4
#error This Object dictionary is compatible with CANopenNode V4.0 and above!
#endif

/*******************************************************************************
    OD data initialization of all groups
*******************************************************************************/
${odname}_ATTR_RAM ${odname}_RAM_t ${odname}_RAM = {
};

/*******************************************************************************
    All OD objects (constant definitions)
*******************************************************************************/
typedef struct {
    ${prepared.ODObjs_t.join('\n    ')}
} ${odname}Objs_t;

static CO_PROGMEM ${odname}Objs_t ${odname}Objs = {
${prepared.ODObjs.join('\n')}
};

/*******************************************************************************
    Object dictionary
*******************************************************************************/
static ${odname}_ATTR_OD OD_entry_t ${odname}List[] = {
    ${prepared.ODList.join(',\n    ')},
    {0x0000, 0x00, 0, NULL, NULL}
};

static OD_t _${odname} = {
    (sizeof(${odname}List) / sizeof(${odname}List[0])) - 1,
    &${odname}List[0]
};

OD_t *${odname} = &_${odname};`);

    return lines.join('\n') + '\n';
}

module.exports = exports = { exportOD };
